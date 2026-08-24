import { appError } from '../../lib/app-error.ts';
import { logger } from '../../lib/logger.ts';
import type { ContextUser } from '../context.ts';
import { middleware } from '../init.ts';

// The two roles a procedure can require. `assistant` is deliberately
// excluded — `02-has-role.md` step 4 rejects it everywhere in P02, loudly,
// until `phase-25-white-label-and-teams/team-seats-and-roles/` defines what
// it may see.
type SingleRole = 'coach' | 'client';

const ROLE_REQUIRED_MESSAGE = 'This action is not available for your account type.';

// Sentry attaches here once `../observability/02-sentry-server.md` lands.
function logProfileIntegrityFailure(requestId: string, userId: string, role: SingleRole): void {
  logger.error('data_integrity.role_missing_profile', { requestId, userId, role });
}

// Takes an already-non-null `user`, never `ctx` — narrowing `ctx.user`
// doesn't survive being passed to another function (only direct property
// access on the same variable does, verified against the compiler), so
// each middleware below null-checks `ctx.user` itself, in its own scope,
// and only then calls this with the narrowed local. The one piece of logic
// shared by both roles (`02-has-role.md` step 1). Exhaustive over the full
// `user_role` enum, no default branch: the explicit `string` return type
// means a value added to DB§4's enum (`identity.users.role`) makes this
// function fail to compile — "lacks ending return statement" — until it's
// given a case, the same way `assistant`'s own P25 deferral was.
function requireProfileId(user: ContextUser, expectedRole: SingleRole, requestId: string): string {
  switch (user.role) {
    case 'assistant':
      throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: expectedRole });
    case 'coach': {
      if (expectedRole !== 'coach') {
        throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: expectedRole });
      }
      const { coachProfileId } = user;
      if (coachProfileId === null) {
        // `coach_profiles.user_id` is UNIQUE and resolved in the same query
        // as the user (`api-scaffold/02`) — a `role='coach'` user with no
        // matching row is a half-created account (an interrupted signup),
        // not an authorization outcome (step 2). Never silently FORBIDDEN.
        logProfileIntegrityFailure(requestId, user.id, 'coach');
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
      const { clientProfileId } = user;
      if (clientProfileId === null) {
        logProfileIntegrityFailure(requestId, user.id, 'client');
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
function requireCoachOrClientRole(role: SingleRole | 'assistant'): void {
  switch (role) {
    case 'assistant':
      throw appError('ROLE_REQUIRED', ROLE_REQUIRED_MESSAGE, { requiredRole: 'coach or client' });
    case 'coach':
    case 'client':
      return;
  }
}

// Two concrete, fully-inferred middlewares — never built from a shared
// generic factory internally, because a generic role parameter can't carry
// its literal value into `next()`'s inferred context type (verified against
// the compiler, not assumed). `hasRole` below is a thin runtime selector
// between them; each one's `typeof` is what gives `hasRole`'s overloads
// their exact, non-union return type.
//
// Each middleware null-checks `ctx.user` itself, locally, before spreading
// it into `next()`'s ctx — spreading `ctx.user` while it's still typed
// `ContextUser | null` (i.e. reading it a second time after a check made
// elsewhere) silently produces an object type with every one of
// `ContextUser`'s fields marked optional instead of failing to compile,
// which then fails *downstream*, opaquely, the first time some other
// middleware composes onto `coachProcedure`/`clientProcedure` expecting a
// real `ContextUser` shape. Assigning `ctx.user` to the local `user` once,
// then never reading `ctx.user` again, is what keeps the narrowing valid
// all the way to the `next()` call.
const coachRoleMiddleware = middleware(({ ctx, next }) => {
  const { user } = ctx;
  if (!user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }
  const coachProfileId = requireProfileId(user, 'coach', ctx.requestId);
  return next({
    ctx: {
      ...ctx,
      user: { ...user, role: 'coach' as const, coachProfileId, clientProfileId: null },
    },
  });
});

const clientRoleMiddleware = middleware(({ ctx, next }) => {
  const { user } = ctx;
  if (!user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }
  const clientProfileId = requireProfileId(user, 'client', ctx.requestId);
  return next({
    ctx: {
      ...ctx,
      user: { ...user, role: 'client' as const, clientProfileId, coachProfileId: null },
    },
  });
});

// `hasRole` selects between the two role-specific middlewares above; this
// one is exported directly since `coachOrClientProcedure` has no per-role
// literal to select on.
export const coachOrClientRole = middleware(({ ctx, next }) => {
  const { user } = ctx;
  if (!user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }
  requireCoachOrClientRole(user.role);
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
