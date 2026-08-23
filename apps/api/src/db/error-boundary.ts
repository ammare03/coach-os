import { fromDatabaseError } from '../lib/app-error.ts';
import { middleware } from '../trpc/init.ts';

import { REPLAY_CONSTRAINTS } from './constraint-map.ts';
import { unwrapDatabaseError } from './is-database-error.ts';
import { SQLSTATE_TREATMENTS } from './sqlstate.ts';

const UNIQUE_VIOLATION = '23505';

/**
 * A unique violation on a table's offline-idempotency index (DB§14.1 step
 * 4: the replay is a success, not an error). Exported so a resolver's own
 * `INSERT` — one written before, or instead of, `.onConflictDoUpdate()` —
 * can catch this specifically and re-select the row it already wrote:
 *
 * ```ts
 * try {
 *   return await ctx.db.insert(setLogs).values(input).returning();
 * } catch (e) {
 *   if (isReplayViolation(e)) {
 *     return ctx.db.select().from(setLogs).where(eq(setLogs.clientLocalId, input.clientLocalId));
 *   }
 *   throw e;
 * }
 * ```
 *
 * The generic boundary below has no way to build that query for an
 * arbitrary table — it doesn't know which column holds the owner id, or
 * which value to filter by — so it is deliberately not `fromDatabaseError`'s
 * job. A replay this helper isn't given the chance to catch still reaches
 * `fromDatabaseError`, which maps it to `SYNC_CONFLICT` rather than a bare
 * `INTERNAL_ERROR`.
 */
export function isReplayViolation(error: unknown): boolean {
  const dbError = unwrapDatabaseError(error);
  return (
    dbError !== undefined &&
    dbError.code === UNIQUE_VIOLATION &&
    REPLAY_CONSTRAINTS.has(dbError.constraint_name ?? '')
  );
}

// 25–100ms, step 5 — enough to let contention on `daily_nutrition_summary`
// (DB§8) clear without turning a slow query into a slow outage.
function jitterMs(): number {
  return 25 + Math.random() * 75;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The single boundary (`error-and-validation/04-no-raw-db-errors.md` step
 * 1) — attached to the base procedure builder in `../trpc/procedures.ts`,
 * **outermost**, so it also catches a database error thrown by
 * `../authorization-middleware/03-owns-resource.md`'s ownership query,
 * which runs further into the same `next()` chain.
 *
 * `next()`'s error result already carries the raw driver error as
 * `.cause` — tRPC's own `getTRPCErrorFromUnknown` wraps any non-`TRPCError`
 * throw as `INTERNAL_SERVER_ERROR` with `cause` set to the original value,
 * referential identity intact, before this middleware ever sees it.
 *
 * Retries exactly once, only for the two SQLSTATEs `sqlstate.ts` marks
 * `retryable` (step 5) — never a loop. Translation itself is
 * `fromDatabaseError`'s job, not this middleware's: retry needs a second
 * `next()`, which only the middleware has, so the two concerns split here.
 */
export const databaseErrorBoundary = middleware(async ({ ctx, next }) => {
  let result = await next();

  if (!result.ok) {
    const dbError = unwrapDatabaseError(result.error.cause);
    if (dbError && SQLSTATE_TREATMENTS[dbError.code]?.retryable) {
      await sleep(jitterMs());
      result = await next();
    }
  }

  if (!result.ok) {
    const dbError = unwrapDatabaseError(result.error.cause);
    if (dbError) {
      throw fromDatabaseError(dbError, { requestId: ctx.requestId });
    }
  }

  // Every middleware passes through what it didn't touch — a non-database
  // error, or the retry's own success, reaches the caller unchanged.
  return result;
});
