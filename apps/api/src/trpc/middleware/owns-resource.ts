import type { TRPCMiddlewareBuilder } from '@trpc/server';

import { appError } from '../../lib/app-error.ts';
import { ownershipCacheKey } from '../authz/ownership-cache.ts';
import {
  RESOURCE_REGISTRY,
  type CoachOnlyResourceKind,
  type ResourceKind,
  type ResourceKindEntry,
  type SharedResourceKind,
} from '../authz/resource-registry.ts';
import type { Context, ContextUser } from '../context.ts';
import { middleware } from '../init.ts';

// The one message every failure of this guard produces (`03-owns-resource.md`
// step 2) — a coach's foreign-client request, a client's foreign-resource
// request, and a well-formed id that never existed are byte-identical.
// Distinguishing them turns the API into an existence oracle, so the code
// is NOT_FOUND and the copy is `ERRORS.md`'s genuine-404 line (ER§2.1).
const NOT_YOUR_CLIENT_MESSAGE = "We couldn't find that.";
// A role that can never own this resource kind is a 403 — it reveals nothing
// about any particular row.
const WRONG_ROLE_MESSAGE = "You don't have access to that.";

function toIdArray(raw: string | string[]): string[] {
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * What a builder's accumulated context must already be for a coach-only
 * kind to compose onto it: `ctx.user` non-null with `role` narrowed to
 * `'coach'` — i.e. the context `hasRole('coach')` produces, and nothing
 * weaker. `clientProcedure` fails it on `role`; `coachOrClientProcedure`
 * and `protectedProcedure` fail it because they leave the union
 * un-narrowed; `publicProcedure` fails it because `user` may be null.
 *
 * Written as a *requirement* rather than mirrored off `has-role.ts`'s
 * output type on purpose — it states the minimum the guard depends on, and
 * a future change that stopped narrowing `role` would fail every coach-only
 * call site loudly instead of silently widening this.
 */
type CoachNarrowedContext = Omit<Context, 'user'> & {
  user: Omit<ContextUser, 'role'> & { role: 'coach' };
};

/**
 * Exactly the shape `middleware()` returns, with the required context left
 * open. tRPC checks `.use()`'s argument contravariantly in this first type
 * parameter, so declaring a narrower context here is what makes the
 * mismatch a compile error at the call site rather than a `ROLE_REQUIRED`
 * at runtime. The remaining parameters are the ones `init.ts`'s factory
 * already fixes: no meta, no context override, and an unconstrained input
 * (the selector's own annotation is what types the input — see the
 * `ownsResource` doc below).
 */
type OwnershipGuard<TRequiredContext> = TRPCMiddlewareBuilder<
  TRequiredContext,
  object,
  object,
  unknown
>;

/**
 * The guard every client-scoped procedure attaches, after `.input()`
 * (`api-scaffold/04`'s router README documents the required chain order —
 * chained before `.input()`, the selector receives `unknown` and rejects
 * everything). `kind` is declared at the call site, never inferred from the
 * field name (step 1) — inference would silently mis-resolve a field named
 * `id`. `selector` is a function so a nested or array id needs no special
 * case.
 *
 * **Annotate the selector's parameter explicitly**, e.g.
 * `ownsResource('workoutSession', (i: { workoutSessionId: string }) =>
 * i.workoutSessionId)`. `TInput` can't be inferred backward through this
 * standalone call the way it would be for a middleware written inline
 * directly inside `.use()` — verified against the compiler, not assumed.
 * Omitting the annotation type-checks anyway with `input: unknown`, which
 * silently defeats the point; there is no compiler error to catch a missing
 * one, so this is a review-time rule.
 *
 * Reads `ctx.user` only, never the input, to decide *who* is asking (step
 * 4) — the ids `selector` returns are *what* they're asking about, and the
 * two must never be confused.
 *
 * **A `CoachOnlyResourceKind` composes only onto a builder that has already
 * narrowed `ctx.user.role` to `'coach'`** — step 8's "structurally
 * unrepresentable", finally expressed in the signature rather than only in
 * `resolveOwnership`'s throw. The overloads carry it: the coach-only one
 * demands `CoachNarrowedContext`, the shared one demands nothing beyond
 * `Context`, and which applies is read off `RESOURCE_REGISTRY` itself.
 */
export function ownsResource<TInput>(
  kind: CoachOnlyResourceKind,
  selector: (input: TInput) => string | string[],
): OwnershipGuard<CoachNarrowedContext>;
export function ownsResource<TInput>(
  kind: SharedResourceKind,
  selector: (input: TInput) => string | string[],
): OwnershipGuard<Context>;
export function ownsResource<TInput>(
  kind: ResourceKind,
  selector: (input: TInput) => string | string[],
): OwnershipGuard<Context> {
  return middleware(async ({ ctx, input, next }) => {
    const ids = toIdArray(selector(input as TInput));
    if (ids.length === 0) {
      return next();
    }

    await resolveOwnership(ctx, kind, ids);

    // Partial ownership is total failure (step 5) — a coach passing twelve
    // ids and owning eleven is rejected outright, never partially served.
    // A partial response would let an attacker binary-search ownership by
    // observing which rows came back.
    const allOwned = ids.every(
      (id) => ctx.ownershipCache.get(ownershipCacheKey(kind, id)) === true,
    );
    if (!allOwned) {
      throw appError('NOT_YOUR_CLIENT', NOT_YOUR_CLIENT_MESSAGE, {});
    }

    return next();
  });
}

// Fills `ctx.ownershipCache` for every id not already memoised this request
// (step 9), then returns — callers read the cache afterward. Exhaustive
// over `ctx.user.role`'s full `'coach' | 'client' | 'assistant'` union, no
// default branch, same reasoning as `has-role.ts`'s own switch: an
// `assistant` reaching here means `hasRole` was skipped, which is a bug in
// the calling procedure, not a case to grant.
async function resolveOwnership(ctx: Context, kind: ResourceKind, ids: string[]): Promise<void> {
  // `ownsResource` composes only after `isAuthed`/`hasRole`
  // (`../procedures.ts`), so `ctx.user` is never null in practice — same
  // defensive note as `has-role.ts`: tRPC's standalone `middleware()` types
  // the incoming ctx as the full `Context` regardless of where it's later
  // `.use()`'d, since narrowing is a property of a chain, not of an
  // individually-defined middleware.
  if (!ctx.user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  const uncachedIds = ids.filter((id) => !ctx.ownershipCache.has(ownershipCacheKey(kind, id)));
  if (uncachedIds.length === 0) {
    return;
  }

  // Annotated, so this stays the one widened `ResourceKindEntry` the switch
  // below was written against — `RESOURCE_REGISTRY` is now `satisfies`-typed,
  // so indexing it with the full union would hand this a union of one entry
  // shape per kind, for no gain here.
  const entry: ResourceKindEntry = RESOURCE_REGISTRY[kind];
  let ownedAmongUncached: Set<string>;

  switch (ctx.user.role) {
    case 'coach': {
      const { coachProfileId } = ctx.user;
      if (coachProfileId === null) {
        // `hasRole` already turns this data-integrity case into
        // `INTERNAL_SERVER_ERROR` before any resolver runs — reaching here
        // means `ownsResource` was attached without it. Fail loudly rather
        // than resolve an empty owner set silently.
        throw appError(
          'INTERNAL_ERROR',
          'Something went wrong. Contact support with this reference.',
          {},
        );
      }
      ownedAmongUncached = await entry.coachOwnedIds(ctx.db, { coachProfileId }, uncachedIds);
      // Three independent, additive ownership paths beyond current
      // ownership — `account-lifecycle/06`'s 30-day former-coach grace
      // window, and `account-lifecycle/07`'s two returning-client re-grants
      // (training history, nutrition). Each is `null` for a kind it
      // structurally cannot reach (`resource-registry.ts`'s own doc on each
      // field) and unions in, never replaces, what `coachOwnedIds` found —
      // a coach is never one of these paths at a time, but nothing here
      // assumes that; each just runs against whatever `coachOwnedIds`
      // didn't already grant.
      for (const grant of [
        entry.formerCoachOwnedIds,
        entry.historySharedOwnedIds,
        entry.nutritionSharedOwnedIds,
      ]) {
        if (!grant) continue;
        const stillIdsToCheck = uncachedIds.filter((id) => !ownedAmongUncached.has(id));
        if (stillIdsToCheck.length === 0) break;
        const granted = await grant(ctx.db, { coachProfileId }, stillIdsToCheck);
        for (const id of granted) {
          ownedAmongUncached.add(id);
        }
      }
      break;
    }
    case 'client': {
      if (!entry.clientOwnedIds) {
        // `coachNote` (and any future coach-only kind) has no client
        // branch at all — not one that returns an empty set (step 8).
        // Reached only if a `clientProcedure` is guarded with a coach-only
        // kind; refuse everything rather than silently grant nothing in a
        // way that could be mistaken for "checked and denied".
        throw appError('ROLE_REQUIRED', WRONG_ROLE_MESSAGE, { requiredRole: 'coach' });
      }
      const { clientProfileId } = ctx.user;
      if (clientProfileId === null) {
        throw appError(
          'INTERNAL_ERROR',
          'Something went wrong. Contact support with this reference.',
          {},
        );
      }
      ownedAmongUncached = await entry.clientOwnedIds(
        ctx.db,
        { clientProfileId, userId: ctx.user.id },
        uncachedIds,
      );
      break;
    }
    case 'assistant':
      throw appError('ROLE_REQUIRED', WRONG_ROLE_MESSAGE, { requiredRole: 'coach or client' });
  }

  for (const id of uncachedIds) {
    ctx.ownershipCache.set(ownershipCacheKey(kind, id), ownedAmongUncached.has(id));
  }
}
