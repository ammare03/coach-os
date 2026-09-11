import {
  PERSONAL_RECORD_TYPES,
  recomputePersonalRecords,
  schema,
  type PersonalRecordType,
  type SetLog,
  type Transaction,
} from '@coachos/db';
import { and, eq } from 'drizzle-orm';

// PR detection on the write path —
// `phase-09-workout-logger/personal-records/02`. What `logSet` tells the
// device about the set it just logged, so `personal-records/03` knows
// whether to celebrate.
//
// Four decisions, in the order they matter:
//
// (a) **This file holds no opinion about what a personal record is.** Every
//     rule — the warm-up and withdrawal exclusions, `reps >= 1`, the four
//     value derivations, the tie-break — lives in exactly one place,
//     `packages/db`'s `recomputePersonalRecords`, because the seed, this
//     write path, and a later withdrawal must all agree about a client's
//     numbers (`code-conventions` §1, this task's own one-implementation
//     constraint). What this file decides is narrower and is the only thing
//     the device needs: **which types this set newly took.**
//
//     So the shape is recompute, then ask which records this set holds —
//     rather than the compare-and-upsert the task's approach section
//     describes. The alternative would put a second, subtly different copy
//     of the rules in TypeScript, and the first thing to drift would be the
//     warm-up exclusion: the one rule four separate branches can each
//     forget separately.
//
// (b) **A warm-up needs no early return, and adding one would be a bug.**
//     The obvious reading of "warm-up sets never trigger PR detection" is
//     `if (set.isWarmup) return []` at the top. But `set_logs` is an upsert
//     table: `set-entry/05` can EDIT a working set into a warm-up by
//     re-sending its `client_local_id` with the flag flipped, and the
//     record that set held must then be withdrawn. Returning early would
//     skip the recompute and strand it.
//
//     The guarantee survives intact, and more strongly: a warm-up never
//     appears among the recompute's candidates, so it can never be a
//     record's `set_log_id`, so the query below can never return a row for
//     one. Warm-ups are excluded by construction rather than by a branch
//     anyone has to remember.
//
// (c) **"Newly took" means this set holds the record now — nothing about
//     what was there before.** The tempting refinement is to compare
//     against the pre-write record and report only a strict increase, so an
//     outbox replay answers `[]` the second time. It is wrong, and the
//     reason is the scenario the outbox exists for: the first response is
//     lost in a tunnel, the device retries, and a server that had already
//     "used up" the announcement would hand back `[]` — losing the
//     celebration entirely for the one client who most needed it replayed.
//
//     Identical input must produce an identical response, however many
//     times it is replayed (`offline-sync` §3, and
//     `workouts.logSet.test.ts` asserts it). Exactly-once is
//     `personal-records/03`'s job, deduped on `clientLocalId` on the
//     device, where the state that decides it actually lives — the server
//     cannot know whether a response it already sent ever arrived.
//
//     The tie-break inside the recompute is what keeps this honest: a
//     second set matching a record does not take it, because the earlier
//     set keeps it. Only a set that genuinely holds a record is ever
//     reported.
//
// (d) **`recompute` is injected**, exactly as `./log-set.ts` injects
//     `recomputeSessionVolume` and for its reason: the transactional
//     coupling this task's Risks section is about is only provable by
//     making the inner call fail.

/** The shape `recomputePersonalRecords` satisfies — injected, decision (d). */
export type RecomputePersonalRecords = (
  tx: Transaction,
  clientId: string,
  exerciseId: string,
) => Promise<void>;

/** Everything detection needs from the set that was just written. */
export type DetectedSet = Pick<SetLog, 'id' | 'clientId' | 'exerciseId'>;

/** The shape `detectPersonalRecords` satisfies — injected into `logSet`. */
export type DetectPersonalRecords = (
  tx: Transaction,
  set: DetectedSet,
) => Promise<PersonalRecordType[]>;

/**
 * Brings `training.personal_records` back into agreement with the client's
 * set history for one exercise, and reports which record types the given
 * set newly took.
 *
 * MUST be called inside the same transaction as the `set_logs` write it is
 * about (DB§8.2) — a record for a set that never commits, or a set whose
 * record never does, are the two halves of this task's stated risk.
 *
 * Returns `[]` when the set took nothing, which is the ordinary case. The
 * order is always `PERSONAL_RECORD_TYPES`' own, so a caller rendering the
 * list never sees it reshuffle between two otherwise identical sets.
 */
export async function detectPersonalRecords(
  tx: Transaction,
  set: DetectedSet,
  recompute: RecomputePersonalRecords = recomputePersonalRecords,
): Promise<PersonalRecordType[]> {
  await recompute(tx, set.clientId, set.exerciseId);

  // One indexed read of at most four rows, on the unique index
  // `(client_id, exercise_id, record_type)`. Decision (b): a warm-up, a
  // withdrawn set, and a zero-rep attempt are all absent from this result by
  // construction, because the recompute never credits one.
  const held = await tx
    .select({ recordType: schema.personalRecords.recordType })
    .from(schema.personalRecords)
    .where(
      and(
        eq(schema.personalRecords.clientId, set.clientId),
        eq(schema.personalRecords.exerciseId, set.exerciseId),
        eq(schema.personalRecords.setLogId, set.id),
      ),
    );

  const mine = new Set(held.map((row) => row.recordType));
  return PERSONAL_RECORD_TYPES.filter((type) => mine.has(type));
}
