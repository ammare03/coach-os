// DB§8.2 — `training.personal_records`, maintained by the application
// inside the same transaction as the write that changes it. Implemented by
// `phase-09-workout-logger/personal-records/02-pr-detection.md`, which is
// the task the README's "stubs, not real logic" section named as this
// function's owner (it names `personal-records/01`; 01 turned out to be
// pure `packages/utils` work and landed the Epley formula there instead,
// so the detection half arrived here at 02).
//
// Five decisions, in the order they matter:
//
// (a) **This is the only place in the product that decides what a personal
//     record IS.** `apps/api/src/lib/pr-detection.ts` runs on the hot path
//     and reports which types a given set newly took, but it holds no
//     opinion about qualification — it calls this and diffs the result.
//     There is one rule, in one statement, so a warm-up excluded here is a
//     warm-up excluded everywhere, and the seed, the logger, and a
//     withdrawal cannot disagree about a client's numbers
//     (`code-conventions` §1).
//
// (b) **Derived from history, not accumulated.** `set_logs` is an UPSERT
//     table: `set-entry/05` edits a set by re-sending the same
//     `client_local_id` with new numbers, and `set-entry/06` withdraws one
//     by setting `deleted_at`. Both can LOWER a value. An incremental
//     "is this bigger than the stored record" check — which is what this
//     task's own approach section describes — can only ever raise a record,
//     so a mistyped 200kg corrected to 100kg would leave a 200kg PR
//     standing forever. Recomputing from the rows is immune, and it makes
//     the function safe to call twice, which the outbox guarantees it will
//     be.
//
// (c) **The Epley formula does not appear here, and must not.** The
//     `1rm_estimated` candidate reads `set_logs.estimated_1rm_kg`, the
//     column `log-set.ts` decision (d) computes on write via
//     `packages/utils`' `estimateOneRepMax`. Re-expressing `w × (1 + r/30)`
//     in SQL would be the second copy `personal-records/01` exists to
//     prevent — and `packages/db` cannot import `@coachos/utils` anyway
//     (`recompute-session-volume.ts` decision (a)). The consequence is
//     real and deliberate: any set whose `estimated_1rm_kg` was never
//     computed holds no `1rm_estimated` record. `pnpm db:seed` is exactly
//     that case — see `seed/training-history.ts`'s call site.
//
// (d) **A record requires a set that was actually performed**: `reps >= 1`,
//     not a warm-up, not withdrawn. The zero-rep case is the one worth
//     naming — `packages/schemas` permits `reps: 0` as a failed attempt
//     (`set-entry/04`'s `isFailure`), and a bar loaded to 200kg and not
//     moved is not a 200kg record. Putting the predicate in one `WHERE`
//     shared by all four candidate types is what stops it being remembered
//     in three branches out of four.
//
// (e) **A value `numeric(10,2)` cannot hold is refused, not raised.**
//     `reps × weight_kg` at the schema's own ceilings overflows the column;
//     a 22003 here would take the client's entire set down with it. This is
//     `estimateOneRepMax`'s judgement at `NUMERIC_6_2_MAX`, applied to the
//     one candidate that can reach it.
import { sql } from 'drizzle-orm';

import { personalRecords, setLogs } from '../schema/training.ts';

import type { Transaction } from './types.ts';

/** What `numeric(10, 2)` — `personal_records.value` — can hold. Decision (e). */
const PERSONAL_RECORD_VALUE_MAX = '99999999.99';

/**
 * Re-derives every `training.personal_records` row for one client and one
 * exercise from that pair's own `set_logs`: the highest estimated 1RM,
 * weight, rep count, and volume across their performed working sets, each
 * credited to the set that first reached it.
 *
 * MUST be called inside the same transaction as any write that changes
 * those sets — an insert, an edit, or a withdrawal (DB§8.2, README.md). It
 * never opens a transaction of its own, so a failure here rolls that write
 * back with it, which is the guarantee this task's Risks section asks for:
 * a PR is never recorded for a set log that does not commit.
 *
 * Safe to call repeatedly, and safe to call when nothing changed.
 */
export async function recomputePersonalRecords(
  tx: Transaction,
  clientId: string,
  exerciseId: string,
): Promise<void> {
  await tx.execute(sql`
    WITH working AS (
      SELECT id, logged_at, reps, weight_kg, estimated_1rm_kg
      FROM ${setLogs}
      WHERE ${setLogs.clientId} = ${clientId}::uuid
        AND ${setLogs.exerciseId} = ${exerciseId}::uuid
        AND ${setLogs.isWarmup} = FALSE
        AND ${setLogs.deletedAt} IS NULL
        AND ${setLogs.reps} >= 1
    ),
    candidates AS (
                SELECT id, logged_at, '1rm_estimated'::text AS record_type, estimated_1rm_kg        AS value FROM working
      UNION ALL SELECT id, logged_at, 'max_weight',                         weight_kg                        FROM working
      UNION ALL SELECT id, logged_at, 'max_reps',                           reps::numeric                    FROM working
      UNION ALL SELECT id, logged_at, 'max_volume',                         reps::numeric * weight_kg        FROM working
    ),
    winners AS (
      SELECT DISTINCT ON (record_type)
        record_type, value, id AS set_log_id, logged_at AS achieved_at
      FROM candidates
      WHERE value IS NOT NULL
        AND value > 0
        AND value <= ${PERSONAL_RECORD_VALUE_MAX}::numeric
      -- Ties keep the EARLIER set: the client set that record then, and
      -- matching it again is not a new one. \`id\` is uuidv7, so it breaks a
      -- same-instant tie in logged order rather than arbitrarily.
      ORDER BY record_type, value DESC, logged_at ASC, id ASC
    ),
    -- A type with no qualifying set left (every set withdrawn, or the only
    -- weighted one edited to bodyweight) loses its row outright. Disjoint
    -- from the INSERT below by construction — it touches exactly the types
    -- \`winners\` does not.
    withdrawn AS (
      DELETE FROM ${personalRecords}
      WHERE ${personalRecords.clientId} = ${clientId}::uuid
        AND ${personalRecords.exerciseId} = ${exerciseId}::uuid
        AND ${personalRecords.recordType} NOT IN (SELECT record_type FROM winners)
      RETURNING id
    )
    INSERT INTO ${personalRecords} (client_id, exercise_id, record_type, value, set_log_id, achieved_at)
    SELECT ${clientId}::uuid, ${exerciseId}::uuid, record_type, value, set_log_id, achieved_at
    FROM winners
    ON CONFLICT (client_id, exercise_id, record_type) DO UPDATE SET
      value = EXCLUDED.value,
      set_log_id = EXCLUDED.set_log_id,
      achieved_at = EXCLUDED.achieved_at
  `);
}
