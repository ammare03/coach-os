import { appError } from '../../lib/app-error.ts';
import { ownershipCacheKey } from '../authz/ownership-cache.ts';
import { RESOURCE_REGISTRY, type ResourceKind } from '../authz/resource-registry.ts';
import type { Context } from '../context.ts';
import { middleware } from '../init.ts';

// The one message every failure of this guard produces (`03-owns-resource.md`
// step 2) — a coach's foreign-client request, a client's foreign-resource
// request, and a well-formed id that never existed are byte-identical.
// Distinguishing them turns the API into an existence oracle.
const NOT_YOUR_CLIENT_MESSAGE = "You don't have access to that.";

function toIdArray(raw: string | string[]): string[] {
  return Array.isArray(raw) ? raw : [raw];
}

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
 */
export function ownsResource<TInput>(
  kind: ResourceKind,
  selector: (input: TInput) => string | string[],
) {
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

  const entry = RESOURCE_REGISTRY[kind];
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
      break;
    }
    case 'client': {
      if (!entry.clientOwnedIds) {
        // `coachNote` (and any future coach-only kind) has no client
        // branch at all — not one that returns an empty set (step 8).
        // Reached only if a `clientProcedure` is guarded with a coach-only
        // kind; refuse everything rather than silently grant nothing in a
        // way that could be mistaken for "checked and denied".
        throw appError('ROLE_REQUIRED', NOT_YOUR_CLIENT_MESSAGE, { requiredRole: 'coach' });
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
      throw appError('ROLE_REQUIRED', NOT_YOUR_CLIENT_MESSAGE, { requiredRole: 'coach or client' });
  }

  for (const id of uncachedIds) {
    ctx.ownershipCache.set(ownershipCacheKey(kind, id), ownedAmongUncached.has(id));
  }
}
