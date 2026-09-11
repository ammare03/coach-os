// DB§8.2 — `training.workout_sessions.total_volume_kg`, maintained by the
// application inside the same transaction as the write that changes it.
// Implemented by `phase-09-workout-logger/session-runtime/07-completion.md`,
// which is the task the README's "stubs, not real logic" section named as
// this function's owner.
//
// Three decisions, in the order they matter:
//
// (a) **The sum is one SQL statement, not a round trip through JavaScript.**
//     `packages/utils`' `sessionVolumeKg` is the same rule in TypeScript and
//     is the one the client's completed card renders — but `packages/db`
//     does not depend on `@coachos/utils` and must not start to: this
//     package's stated contents are "Drizzle schema, migrations, seed" and
//     nothing else (`CLAUDE.md` §4). Pulling every set row of a session
//     across the wire to add them up inside a transaction that already holds
//     the session's lock would also be the wrong shape for an aggregate.
//
//     So the rule exists twice, and it is **pinned rather than trusted**:
//     `apps/api/src/routers/__tests__/workouts.complete.test.ts` is the one
//     place that can import both, and it asserts they agree to the cent on
//     the same data. If they ever diverge, that test fails — which is the
//     protection `code-conventions` §1's one-implementation rule is actually
//     asking for.
//
// (b) **`SUM` returning `NULL` is the answer, not a gap to fill.** Postgres
//     ignores NULL inputs and yields NULL over an empty set, which is
//     exactly `sessionVolumeKg`'s "returns null when no working set carries
//     both a rep count and a weight". A bodyweight session must store NULL,
//     never `0`: `0` renders as "you lifted nothing", which is a judgement
//     about the session rather than a fact about it (`COPY.md` CO§2). This
//     is also why the stub this replaced threw instead of writing `'0'`.
//
// (c) **Warm-ups and soft-deleted sets are excluded, and that is the whole
//     of the business logic.** A heavier warm-up must not make a session
//     look harder, and a set the client deleted is not work they did. Both
//     predicates live here, beside the sum, rather than in the caller — the
//     caller's job is to run this inside its transaction, not to know what a
//     working set is.
import { eq, sql } from 'drizzle-orm';

import { setLogs, workoutSessions } from '../schema/training.ts';

import type { Transaction } from './types.ts';

/**
 * Recomputes one session's `total_volume_kg` from its own set logs:
 * Σ (reps × weight_kg) across non-warm-up, non-deleted sets.
 *
 * MUST be called inside the same transaction that marks a
 * `training.workout_sessions` row completed (DB§8.2, README.md). It never
 * opens a transaction of its own, so a failure here rolls the transition
 * back with it — which is the guarantee, not a side effect.
 *
 * Safe to call more than once: it recomputes from the rows rather than
 * accumulating, so a replayed completion (or one that arrives before the
 * last set has synced and is retried afterwards) converges on the truth.
 */
export async function recomputeSessionVolume(
  tx: Transaction,
  workoutSessionId: string,
): Promise<void> {
  await tx
    .update(workoutSessions)
    .set({
      totalVolumeKg: sql`(
        SELECT SUM(${setLogs.reps} * ${setLogs.weightKg})
        FROM ${setLogs}
        WHERE ${setLogs.workoutSessionId} = ${workoutSessions.id}
          AND ${setLogs.isWarmup} = FALSE
          AND ${setLogs.deletedAt} IS NULL
      )`,
    })
    .where(eq(workoutSessions.id, workoutSessionId));
}
