// DB§14.3's third rule, for exactly one column on exactly one table:
// `workout_sessions.status` resolves by last-write-wins on `updated_at`,
// because both the client's device and a live coach can legitimately change
// it and neither is definitively more correct. Every other column on this
// table keeps its own rule — largely device-wins, since most of them are
// client-authored — and is written through unchanged.
//
// This is deliberately a named special case, not a reusable comparator.
// DB§14.3 gives this rule to one field; a general last-write-wins helper
// would be machinery for a problem the spec does not have anywhere else
// (`sync-engine/04` Approach step 1).
//
// ── The payload contract phase-09 must honour ────────────────────────────
//
// `updatedAt` is the moment of the LOCAL CHANGE on the device, captured
// when the user acted — never `new Date()` at outbox-flush time, and never
// filled in server-side. A device that changed the status first but flushed
// late (it was in a gym basement for an hour) must not lose to a change
// that happened later in real time simply because that change reached the
// server first. Capturing at flush time makes this comparison meaningless.
// `enqueueMutation` (apps/mobile) serialises the payload with superjson at
// action time and the flush loop replays it verbatim, so a `Date` put in
// the payload at action time is still that `Date` on arrival — the contract
// is achievable today, and it is the caller's job to put the right value in.
//
// For a write that originates on the server (a live coach adjusting a
// session), `updatedAt` is the server's own clock at that moment, which is
// both truthful and, by construction, later than any write already stored.
//
// ── How migration 0021's touch_updated_at trigger interacts ──────────────
//
// `platform.touch_updated_at` is `BEFORE UPDATE ... NEW.updated_at = now()`
// and fires unconditionally, so the STORED `updated_at` is "when the server
// last wrote this row", not "when the device made the change". Two
// consequences, both load-bearing:
//
//   1. The comparison itself is unaffected. It reads `excluded.updated_at`
//      — the proposed insert row, which the trigger never sees — against the
//      stored column. There is no BEFORE INSERT trigger, so a row's first
//      write does store the device's own change time.
//   2. Once a write with a lagging timestamp wins, the row's comparison
//      basis advances to the server clock rather than staying at that
//      device's timestamp. So the resolution is order-independent for the
//      case DB§14.3 exists for (one offline device against an online coach,
//      whose `updated_at` is truthful), and order-dependent only when TWO
//      lagging offline writers race for the same session. DB§14.5 addresses
//      that case with mechanism 3, the session claim (`active_device_id` /
//      `claimed_at`): the second device is offered "continue here", which
//      transfers the claim and refetches server truth. Concurrent two-device
//      writing is prevented there, not merged here — and there is no merge
//      UI (DB§14.3).
import { schema } from '@coachos/db';
import { getTableColumns, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';

import { offlineUpsert, type OfflineUpsertDb } from './offline-upsert.ts';

const { workoutSessions } = schema;

type WorkoutSession = typeof workoutSessions.$inferSelect;
type WorkoutSessionInsert = typeof workoutSessions.$inferInsert;

export type WorkoutSessionUpsertValues = Omit<
  WorkoutSessionInsert,
  'clientLocalId' | 'updatedAt'
> & {
  /** Required here, unlike the nullable column: it is half the conflict target. */
  clientLocalId: string;
  /** The moment of the local change — see the payload contract above. */
  updatedAt: Date;
};

const NEVER_UPDATED_ON_CONFLICT = new Set([
  // A replay must not move the row's identity or its creation time.
  'id',
  'created_at',
  // The conflict target itself.
  'client_id',
  'client_local_id',
  // DB§6's denormalised ownership column, INSERT-only and enforced by
  // `workout_sessions_no_owner_change` (migration 0022).
  'coach_id',
  // Owned by the trigger on this path; writing it would be a no-op that
  // reads like an intent.
  'updated_at',
  // Owned by the last-write-wins expression below.
  'status',
]);

/**
 * `excluded.status` when the arriving write is newer than the stored row,
 * the stored status otherwise. One expression inside the `DO UPDATE`, not a
 * read followed by a write: two concurrent writers on the same conflict
 * target serialise on the row lock, and the second one's `CASE` is then
 * evaluated against the row the first just committed. A read-then-write
 * would compare against a snapshot taken before the race and let the older
 * write clobber the newer one.
 *
 * Equal timestamps keep the stored status, so replaying an identical
 * payload is a no-op on this column (DB§14.1).
 */
const statusLastWriteWins = sql`CASE WHEN excluded.updated_at > ${workoutSessions.updatedAt} THEN excluded.status ELSE ${workoutSessions.status} END`;

/** Everything the write carries except the columns above — DB§14.3's device-wins default. */
function deviceWinsSet(
  values: WorkoutSessionUpsertValues,
): PgUpdateSetSource<typeof workoutSessions> {
  const supplied: Record<string, unknown> = { ...values };
  const set: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(getTableColumns(workoutSessions))) {
    if (!Object.hasOwn(supplied, key) || supplied[key] === undefined) continue;
    if (NEVER_UPDATED_ON_CONFLICT.has(column.name)) continue;
    set[key] = supplied[key];
  }

  // Built key by key from the table's own column list, so every key is a
  // real column; the compiler cannot see that through a string index.
  return set as PgUpdateSetSource<typeof workoutSessions>;
}

/**
 * Upserts a workout session on `(client_id, client_local_id)` and returns
 * the resulting row. Status resolves last-write-wins; everything else the
 * payload carries is applied as sent, including on a write whose status
 * lost.
 *
 * ⚠️ `status` and the columns the CHECK constraints tie to it
 * (`started_at`, `completed_at`, `skip_reason`) are resolved separately: a
 * write whose status loses still applies whichever of those it carries.
 * Send them together with the status they belong to, and omit them
 * otherwise — a payload that nulls `skip_reason` while losing to a stored
 * `skipped` row is rejected by `session_skip_reason` (23514). That is loud
 * by design; the alternative is a row that contradicts its own status.
 */
export async function upsertWorkoutSession(
  db: OfflineUpsertDb,
  values: WorkoutSessionUpsertValues,
): Promise<WorkoutSession> {
  return offlineUpsert(db, {
    table: workoutSessions,
    values,
    target: [workoutSessions.clientId, workoutSessions.clientLocalId],
    onConflict: 'update',
    set: { ...deviceWinsSet(values), status: statusLastWriteWins },
  });
}
