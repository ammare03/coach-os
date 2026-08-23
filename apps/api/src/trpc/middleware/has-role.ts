import { appError } from '../../lib/app-error.ts';
import type { Context } from '../context.ts';
import { middleware } from '../init.ts';

// The two roles a procedure can require. `assistant` is deliberately
// excluded — `02-has-role.md` step 4 rejects it everywhere in P02, loudly,
// until `phase-25-white-label-and-teams/team-seats-and-roles/` defines what
// it may see.
type SingleRole = 'coach' | 'client';

const ROLE_REQUIRED_MESSAGE = 'This action is not available for your account type.';

// Sentry attaches here once `../observability/02-sentry-server.md` lands;
// `console.error` is the sanctioned sink until then (`../lib/app-error.ts`).
// Takes the already-extracted fields, not the whole `ctx` — narrowing
// `ctx.user` inside `requireProfileId` below doesn't carry through a
// container object passed to another function, only through direct
// property access, so this sidesteps that rather than re-guarding.
function logProfileIntegrityFailure(requestId: string, userId: string, role: SingleRole): void {
  console.error('[data-integrity] role has no matching profile row', { requestId, userId, role });
}

// The one piece of logic shared by both roles below, so it exists once
// (`02-has-role.md` step 1). Exhaustive over the full `user_role` enum, no
// default branch: the explicit `string` return type means a value added to
// DB§4's enum (`identity.users.role`) makes this function fail to compile —
// "lacks ending return statement" — until it's given a case, the same way
// `assistant`'s own P25 deferral was given one deliberately rather than
// falling through a default.
function requireProfileId(ctx: Context, expectedRole: SingleRole): string {
  // `hasRole` is only ever composed after `isAuthed` (`../procedures.ts`),
  // so `ctx.user` is never null in practice. tRPC's standalone `middleware()`
  // still types the incoming ctx as the full `Context`, since narrowing is a
  // property of a `.use()` *chain*, not of an individually-defined
  // middleware — this exists for the type system, not because it fires.
  if (!ctx.user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  switch (ctx.user.role) {
    case 'assistant':
      throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: expectedRole });
    case 'coach': {
      if (expectedRole !== 'coach') {
        throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: expectedRole });
      }
      const { coachProfileId } = ctx.user;
      if (coachProfileId === null) {
        // `coach_profiles.user_id` is UNIQUE and resolved in the same query
        // as the user (`api-scaffold/02`) — a `role='coach'` user with no
        // matching row is a half-created account (an interrupted signup),
        // not an authorization outcome (step 2). Never silently FORBIDDEN.
        logProfileIntegrityFailure(ctx.requestId, ctx.user.id, 'coach');
        throw appError(
          'INTERNAL_ERROR',
          'Something went wrong. Contact support with this reference.',
          {},
        );
      }
      return coachProfileId;
    }
    case 'client': {
      if (expectedRole !== 'client') {
        throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: expectedRole });
      }
      const { clientProfileId } = ctx.user;
      if (clientProfileId === null) {
        logProfileIntegrityFailure(ctx.requestId, ctx.user.id, 'client');
        throw appError(
          'INTERNAL_ERROR',
          'Something went wrong. Contact support with this reference.',
          {},
        );
      }
      return clientProfileId;
    }
  }
}

// Same exhaustiveness guarantee as `requireProfileId` above, for the
// shared builder that accepts either real role and asserts only that
// `assistant` is excluded — `coachOrClientProcedure`'s resolvers (e.g.
// `workouts.logSet`, `comments.create`) branch on `ctx.user.role`
// themselves, so this deliberately returns without narrowing it further.
function requireCoachOrClientRole(ctx: Context): SingleRole {
  // Same defensive note as `requireProfileId` above.
  if (!ctx.user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  switch (ctx.user.role) {
    case 'assistant':
      throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: 'coach or client' });
    case 'coach':
      return 'coach';
    case 'client':
      return 'client';
  }
}

// Two concrete, fully-inferred middlewares — never built from a shared
// generic factory internally, because a generic role parameter can't carry
// its literal value into `next()`'s inferred context type (verified against
// the compiler, not assumed). `hasRole` below is a thin runtime selector
// between them; each one's `typeof` is what gives `hasRole`'s overloads
// their exact, non-union return type.
const coachRoleMiddleware = middleware(({ ctx, next }) => {
  const coachProfileId = requireProfileId(ctx, 'coach');
  return next({
    ctx: {
      ...ctx,
      user: { ...ctx.user, role: 'coach' as const, coachProfileId, clientProfileId: null },
    },
  });
});

const clientRoleMiddleware = middleware(({ ctx, next }) => {
  const clientProfileId = requireProfileId(ctx, 'client');
  return next({
    ctx: {
      ...ctx,
      user: { ...ctx.user, role: 'client' as const, clientProfileId, coachProfileId: null },
    },
  });
});

// `hasRole` selects between the two role-specific middlewares above; this
// one is exported directly since `coachOrClientProcedure` has no per-role
// literal to select on.
export const coachOrClientRole = middleware(({ ctx, next }) => {
  requireCoachOrClientRole(ctx);
  return next();
});

/**
 * Composes onto `protectedProcedure` only — applying it to `publicProcedure`
 * fails typecheck, since `AuthenticatedContext` is what it reads `ctx.user`
 * from. Narrows `ctx.user.role` to the requested role and asserts the
 * corresponding profile id is a non-null `string`, the other one `null`.
 *
 * Role is *not* ownership (`02-has-role.md` step 3): this proves the caller
 * IS a coach, never that they are THIS client's coach —
 * `../authorization-middleware/03-owns-resource.md` is the only check that
 * answers that question.
 */
export function hasRole(role: 'coach'): typeof coachRoleMiddleware;
export function hasRole(role: 'client'): typeof clientRoleMiddleware;
export function hasRole(role: SingleRole) {
  return role === 'coach' ? coachRoleMiddleware : clientRoleMiddleware;
}
