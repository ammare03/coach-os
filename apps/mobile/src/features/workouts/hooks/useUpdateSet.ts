import { eq } from 'drizzle-orm';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';

// `phase-09-workout-logger/set-entry/05` — correcting a set that is already
// logged. `useLogSet`'s sibling, and deliberately its near-twin: same local
// mirror, same outbox, same procedure, no network in the path either way.
// Five things differ, and each is the whole of a way an edit goes wrong.
//
// (a) **The key is reused, never regenerated.** The correction is the SAME
//     `workouts.logSet` mutation re-sent under the SAME `client_local_id`,
//     which is the entire mechanism that makes the server's
//     `ON CONFLICT (client_id, client_local_id)` an UPDATE rather than a
//     second set (task 05 Risks, `offline-sync` §3). `enqueueMutation`
//     withholds that key from callers by default for exactly the opposite
//     reason — so no retry path can invent a fresh one — and
//     `reuseClientLocalId` is the narrow, validated opt-in that says
//     "I mean this existing row", documented at `lib/outbox/enqueue.ts`.
//
// (b) **The correction is ordered behind the write it corrects.** Two outbox
//     rows carrying one key are not siblings: if the original landed last it
//     would upsert the pre-edit values back over the correction, and the
//     coach would read a number the client never entered. `enqueueMutation`
//     chains it (DB§14.2) without this file asking, because `set-entry/06`
//     needs the identical guarantee.
//
// (c) **`logged_at` does not move.** The edit corrects a value, not a time.
//     `set_logs_client_exercise` is indexed on that instant and answers
//     "last time you did this exercise", and the training day a set belongs
//     to is the local calendar day of it (`CLAUDE.md` §25.5). Re-stamping at
//     the correction would silently move the set, sometimes across a day
//     boundary, and the server overwrites `logged_at` with whatever the
//     payload names — so the original is re-sent verbatim.
//
// (d) **Identity comes from the stored row, never from the caller.** The
//     session, exercise, and set number are read back rather than accepted,
//     so no edit can re-point a set at a different exercise. The caller
//     supplies only the numbers it just re-rendered.
//
// (e) **No analytics event.** `set_logged` describes the two-tap log and
//     carries `entry_ms` to prove §19's budget; re-firing it on a correction
//     would inflate every per-set denominator and poison that measurement
//     (`analytics-events` §5, §7). A distinct `set_edited` event is not added
//     either: §1 of the same skill says an event nobody has committed to
//     reading does not get created, and `CLAUDE.md` §20's volume budget is
//     already tightest on exactly this surface.
//
// `estimated_1rm_kg` is not recomputed here. The server does it on every
// upsert (`apps/api/src/features/workouts/log-set.ts`, Epley), and a second
// implementation on the device is a formula in two places — one of which is
// already wrong (`code-conventions` §1).

/** The tRPC path the outbox replays. The same procedure a fresh log queues — the key decides. */
export const UPDATE_SET_PROCEDURE = 'workouts.logSet';

/** One already-logged set, as the caller asks for it to be corrected. */
export interface UpdateSetArgs {
  /**
   * `local_set_logs.client_local_id` of the set being corrected — the value
   * `useLogSet` returned as `LoggedSet.localId`. It is re-sent verbatim, and
   * it is what makes this an update.
   */
  setLocalId: string;
  /**
   * The corrected values. **Every field is a field the server overwrites**,
   * so what is sent is the whole set, not a patch — that is what
   * `workouts.logSet` does with a key it already knows.
   *
   * Omitting one falls back to the device's stored value for it, so a
   * composer that edits only the weight does not have to restate the reps.
   */
  reps?: number;
  /** Kilograms, always (`CLAUDE.md` §0). `null` clears a weight to bodyweight. */
  weightKg?: number | null;
  isWarmup?: boolean;
  /** Taken to momentary failure. Falls back to the stored flag, like its siblings. */
  isFailure?: boolean;
}

/** What the caller gets back, synchronously enough to re-render from. */
export interface UpdatedSet {
  /** Unchanged — the same key the set has always had. Rule (a). */
  localId: string;
  /** The `outbox.id` of the queued correction, for anything that must sync after it. */
  outboxId: string;
  setNumber: number;
  /** The ORIGINAL tap instant, preserved. Rule (c). */
  loggedAt: Date;
}

export interface UpdateSetDeps extends UpdateSetArgs {
  /** Accepted for parity with `useLogSet`; nothing about the write depends on it. */
  isConnected?: boolean;
  db?: LocalDb;
}

/**
 * Corrects one logged set locally and queues the server's half.
 *
 * Exported separately from the hook so the rules above can be tested without
 * a renderer, the same shape `logSet` and `completeSession` are exported in.
 *
 * Throws when the device holds no such set — `ERRORS.md` ER§1.4's local-read
 * failure, which the logger already has a state for, and not reachable from
 * a row the logger is currently rendering. A set belonging to a completed
 * session is **not** refused: the server accepts one and re-totals the
 * session's volume in the same transaction (`log-set.ts`), which is exactly
 * what a correction to a finished workout should do.
 */
export async function updateSet(deps: UpdateSetDeps): Promise<UpdatedSet> {
  const db = deps.db ?? (await getLocalDb());

  const [existing] = await db
    .select({
      clientLocalId: localSetLogs.clientLocalId,
      sessionLocalId: localSetLogs.sessionLocalId,
      exerciseId: localSetLogs.exerciseId,
      setNumber: localSetLogs.setNumber,
      reps: localSetLogs.reps,
      weightKg: localSetLogs.weightKg,
      isWarmup: localSetLogs.isWarmup,
      isFailure: localSetLogs.isFailure,
      loggedAt: localSetLogs.loggedAt,
    })
    .from(localSetLogs)
    .where(eq(localSetLogs.clientLocalId, deps.setLocalId))
    .limit(1);

  if (!existing) {
    throw new Error(`updateSet: no local_set_logs row for "${deps.setLocalId}"`);
  }

  // Rule (d). Only the numbers are the caller's; everything that identifies
  // the set is the row's own.
  const reps = deps.reps ?? existing.reps ?? 0;
  const weightKg = deps.weightKg === undefined ? existing.weightKg : deps.weightKg;
  const isWarmup = deps.isWarmup ?? existing.isWarmup;
  // Read back like every other field, now that `local_set_logs` carries the
  // column (`set-entry/04`). It defaulted to `false` while the mirror had
  // nowhere to hold it, which silently cleared the flag on any correction
  // that did not restate it.
  const isFailure = deps.isFailure ?? existing.isFailure;
  const loggedAt = new Date(existing.loggedAt);

  const [session] = await db
    .select({ startOutboxId: localWorkoutSessions.startOutboxId })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, existing.sessionLocalId))
    .limit(1);

  // Outbox first, then the mirror — `useLogSet` rule (b)'s argument, which
  // holds identically for a correction: if the second write fails the server
  // still learns of it and the next prefetch brings it back, whereas the
  // other order leaves a corrected row on screen that nothing will ever sync.
  //
  // `dependsOn` is the session's start, as a fresh log would use, and is
  // superseded by the original set's own mutation whenever that is still
  // queued (rule (b)) — `enqueueMutation` resolves which.
  const { outboxId, clientLocalId } = await enqueueMutation({
    procedure: UPDATE_SET_PROCEDURE,
    payload: {
      sessionClientLocalId: existing.sessionLocalId,
      exerciseId: existing.exerciseId,
      setNumber: existing.setNumber,
      reps,
      weightKg,
      loggedAt,
      isWarmup,
      isFailure,
    },
    reuseClientLocalId: existing.clientLocalId,
    ...(session?.startOutboxId == null ? {} : { dependsOn: session.startOutboxId }),
  });

  await db
    .update(localSetLogs)
    .set({
      reps,
      weightKg,
      isWarmup,
      isFailure,
      // The device authored this correction and the server has not confirmed
      // it, so a refresh must not overwrite it (`offline-sync` §5). A row
      // that had already synced goes back to pending.
      syncState: 'pending',
    })
    .where(eq(localSetLogs.clientLocalId, existing.clientLocalId));

  return { localId: clientLocalId, outboxId, setNumber: existing.setNumber, loggedAt };
}

export interface UseUpdateSetResult {
  /**
   * Corrects one logged set and queues the server's half.
   *
   * Rejects only on a local-mirror failure — `ERRORS.md` ER§1.4's
   * `LOCAL_READ_FAILED`. There is no network outcome to surface: the
   * correction is durable the moment this resolves, whatever the radio is
   * doing, and offline and online run the identical path.
   */
  updateSet: (args: UpdateSetArgs) => Promise<UpdatedSet>;
}

export function useUpdateSet(): UseUpdateSetResult {
  const { isConnected } = useConnectivity();

  const update = useCallback(
    (args: UpdateSetArgs) => updateSet({ ...args, isConnected }),
    [isConnected],
  );

  return { updateSet: update };
}
