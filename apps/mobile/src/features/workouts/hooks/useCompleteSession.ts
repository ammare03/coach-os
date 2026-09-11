import { countWorkingSets, totalTargetSets } from '@coachos/utils';
import { eq } from 'drizzle-orm';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';
import { readSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { useRestTimerStore } from '../store/rest-timer-store.ts';

// `phase-09-workout-logger/session-runtime/07` — the in_progress→completed
// transition, and the last move in a session's lifecycle. The summary screen
// it hands off to is `session-summary`'s; this file's job ends the moment the
// local row says `completed` and the server's half is durably queued.
//
// Seven rules, in the order they matter:
//
// (a) **The local write is synchronous with the tap and independent of the
//     network.** The same rule `useStartSession` opens with, and the same
//     reason: a client is standing in a gym basement. The row flips, the
//     caller navigates, and the outbox reaches the server on its own
//     schedule (`offline-sync` §1). Nothing in this path awaits a request.
//
// (b) **The session is named by its `client_local_id`, never its server
//     id.** `useStartSession` names an ASSIGNED session by its server id and
//     is right to: the server materialised that row long before the device
//     lost signal. Completion has no such guarantee. An ad-hoc session is
//     created on the device (`useStartAdHocSession` writes `serverId: null`)
//     and the flush loop writes no id back, so a client who starts an empty
//     session offline and finishes it offline has no `workout_sessions.id`
//     to send. `client_local_id` is the one key both sides always have —
//     deterministic for a materialised session (DB§14.5 mechanism 1),
//     device-generated for an ad-hoc one — so it is what travels.
//     `workouts.complete` resolves it with an UPDATE scoped by `client_id`,
//     which cannot insert, so keying on it forks nothing.
//
// (c) **The completion chains to the session's start.** `startOutboxId` is
//     the parent (DB§14.2, `lib/outbox/enqueue.ts` rule 2): a completion the
//     server saw before the start would find a `scheduled` row and be
//     dropped. When the row carries no stored parent — a session an older
//     build started — it is queued UNCHAINED rather than hung off an invented
//     id: `enqueueMutation` throws on a `dependsOn` that names nothing, and a
//     stranded completion is worse than an unordered one.
//
//     It deliberately does **not** chain to the last set log. Sets are the
//     start's siblings and flush concurrently, which is correct — each is an
//     independent upsert — but it does mean the completion can land before
//     the last set. The server absorbs that: `workouts.complete` recomputes
//     the volume on a replay as well as on the write, so a retry after the
//     straggler lands corrects the total.
//
// (d) **The instant is captured at the tap.** It is `completed_at`, and a
//     client who finishes at 19:00 in a basement and syncs at 21:00 finished
//     at 19:00. Taking it at flush time is `offline-sync` §10's "everything
//     timestamped at reconnect".
//
// (e) **The outbox entry is written before the local row**, the same order
//     and the same reason as both start paths: if the second write fails,
//     the server still learns the session finished and the next prefetch
//     brings the truth back. The other order strands a completed row nothing
//     will ever sync.
//
// (f) **A second tap queues nothing.** The row is already `completed`, so
//     there is nothing to write and nothing to queue, and the caller gets
//     back the instant it would have got the first time. Without this, the
//     double-tap every fullscreen button eventually receives would queue two
//     completions and fire two `workout_completed` events.
//
// (g) **Finishing ends the session's rest** (`rest-timer/02`). The last set
//     of a workout starts a rest like any other, and until task 02 that rest
//     lived only in memory and simply went away with the screen. It is now
//     written to `meta` and read back on the next launch, so leaving it
//     running would restore a countdown for a workout the client finished —
//     and would let `rest-timer/04`'s alert fire after they had left the
//     gym. Scoped to this session, so completing one cannot cancel another's
//     rest. The stored row follows the store (`../lib/rest-timer-persistence.ts`
//     decision (b)), so there is nothing to delete here.

/** The tRPC path the outbox replays. `apps/api/src/routers/workouts.ts`. */
export const COMPLETE_PROCEDURE = 'workouts.complete';

export interface CompletedSession {
  /** `local_workout_sessions.client_local_id` — the id the summary route is opened with. */
  localId: string;
  /**
   * The `outbox.id` of the completion, for anything that has to sync after
   * it — `session-summary/03`'s RPE-and-notes update chains here.
   *
   * `null` only when the session was already complete and nothing was queued
   * (rule (f)). A caller must then enqueue unchained rather than invent a
   * parent, exactly as `StartedSession.outboxId` says.
   */
  outboxId: string | null;
  /** `completed_at`. The stored one when the session was already finished — never moved. */
  completedAt: Date;
}

export interface CompleteSessionDeps {
  /** `local_workout_sessions.client_local_id`, which is what the logger route carries. */
  sessionLocalId: string;
  /** Evaluated at the tap, never at mount — rule (d). Injected so the instant is testable. */
  now?: () => Date;
  /** `was_offline` on the analytics event. Nothing about the write itself depends on it. */
  isConnected?: boolean;
  db?: LocalDb;
}

/**
 * Marks one session complete and queues the server's half.
 *
 * Exported separately from the hook so the rules above can be tested without
 * a renderer, the same shape `startSession` is exported in.
 *
 * Throws when the device holds no such row, and when the row is in a state
 * that cannot be finished — a session that was never started has no
 * `started_at`, which is half of what the `session_completion` CHECK
 * requires, so queuing a completion for one would send a mutation the server
 * can only refuse.
 */
export async function completeSession(deps: CompleteSessionDeps): Promise<CompletedSession> {
  const db = deps.db ?? (await getLocalDb());
  const [row] = await db
    .select()
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, deps.sessionLocalId))
    .limit(1);

  if (!row) {
    throw new Error(`completeSession: no local_workout_sessions row for "${deps.sessionLocalId}"`);
  }

  const completedAt = (deps.now ?? (() => new Date()))();

  // Rule (f). A double tap and a screen re-entered after the fact both land
  // here: the row already says completed, so the caller gets the ids and the
  // instant it would have got the first time, and no second event fires.
  if (row.status === 'completed') {
    return {
      localId: row.clientLocalId,
      outboxId: null,
      completedAt: row.completedAt === null ? completedAt : new Date(row.completedAt),
    };
  }

  if (row.status !== 'in_progress' || row.startedAt === null) {
    // Not a state Finish is ever offered from — the control only exists
    // inside an open, in-progress logger. Loud rather than silent: queuing a
    // mutation the server is bound to leave untouched would report a
    // completion that never happens.
    throw new Error(
      `completeSession: session "${deps.sessionLocalId}" is not in progress (${row.status})`,
    );
  }

  const startedAt = row.startedAt;

  // Rule (e), then rules (b) and (c): the payload names the session by its
  // own key, and carries no `clientLocalId` — `flush.ts` merges the outbox
  // row's own, which is the only authoritative copy of that value.
  const { outboxId } = await enqueueMutation({
    procedure: COMPLETE_PROCEDURE,
    payload: { sessionClientLocalId: row.clientLocalId, completedAt },
    ...(row.startOutboxId === null ? {} : { dependsOn: row.startOutboxId }),
  });

  await db
    .update(localWorkoutSessions)
    .set({
      status: 'completed',
      completedAt: completedAt.getTime(),
      // The device authored this and the server has not confirmed it, so a
      // refresh must not overwrite it (`offline-sync` §5,
      // `lib/prefetch/sessions.ts` rule (c)).
      syncState: 'pending',
      updatedAt: completedAt.getTime(),
    })
    .where(eq(localWorkoutSessions.clientLocalId, row.clientLocalId));

  // Rule (g). A no-op unless the running rest is this session's.
  useRestTimerStore.getState().stopRestForSession(row.clientLocalId);

  // Fire-and-forget, after the write, never awaited (`analytics-events` §7).
  // Wrapped because the counts below read the payload and the set table, and
  // by this point the session HAS completed: letting either failure reach the
  // caller would report a finished session as a failure (`ERRORS.md` ER§3).
  try {
    trackEvent('workout_completed', {
      // The device identity — the same one `workout_started` reported, which
      // is what makes the two joinable into the loop-completion ratio
      // (`ANALYTICS.md` AN§4).
      session_id: asUuid(row.clientLocalId),
      ...(await sessionCounts(db, row.clientLocalId, row.payloadJson)),
      duration_s: durationSeconds(startedAt, completedAt),
      was_offline: deps.isConnected === false,
    });
  } catch {
    // An analytics failure is silent (`ERRORS.md` ER§3).
  }

  return { localId: row.clientLocalId, outboxId, completedAt };
}

/**
 * Whole seconds between the two instants, floored at zero. A phone whose
 * clock moved backwards mid-session reports a finish before its own start,
 * and a negative duration is not one — the server clamps the stored column
 * the same way, so the event and the row agree.
 */
function durationSeconds(startedAtMs: number, completedAt: Date): number {
  return Math.max(0, Math.floor((completedAt.getTime() - startedAtMs) / 1_000));
}

/**
 * `set_count` and `completion_pct`, from the same two rules the logger shell
 * renders with (`useLoggerSession`) rather than a second copy of them —
 * warm-ups are not progress through the plan, so neither counts them.
 *
 * `completion_pct` is `0` for a session with nothing prescribed. An ad-hoc
 * session has no target to be a percentage of, and the loop-completion metric
 * that gates the business is the `workout_started`→`workout_completed` ratio,
 * not this field.
 */
async function sessionCounts(
  db: LocalDb,
  sessionLocalId: string,
  payloadJson: string,
): Promise<{ set_count: number; completion_pct: number }> {
  const sets = await db
    .select({ isWarmup: localSetLogs.isWarmup })
    .from(localSetLogs)
    .where(eq(localSetLogs.sessionLocalId, sessionLocalId));

  const setCount = countWorkingSets(sets);
  const targetSets = totalTargetSets(readSessionPayload(payloadJson)?.session.exercises ?? []);

  return {
    set_count: setCount,
    completion_pct: targetSets === 0 ? 0 : Math.round((setCount / targetSets) * 100),
  };
}

export interface UseCompleteSessionResult {
  /**
   * Marks the session complete and queues the server's half.
   *
   * Rejects rather than returning a union, unlike `useStartSession.start`:
   * every outcome here except an outright local-mirror failure is a success,
   * and the one failure that remains is `ERRORS.md` ER§1.4's
   * `LOCAL_READ_FAILED` — which the caller renders the same way it already
   * renders the logger's own error state.
   */
  complete: (sessionLocalId: string) => Promise<CompletedSession>;
}

export function useCompleteSession(): UseCompleteSessionResult {
  const { isConnected } = useConnectivity();

  const complete = useCallback(
    (sessionLocalId: string) => completeSession({ sessionLocalId, isConnected }),
    [isConnected],
  );

  return { complete };
}
