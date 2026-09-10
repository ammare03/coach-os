import { eq } from 'drizzle-orm';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';
import { readSessionPayload } from '../../../lib/prefetch/sessions.ts';

// `phase-09-workout-logger/session-runtime/01` — the scheduled→in_progress
// transition for an ASSIGNED session. The ad-hoc path
// (`useStartAdHocSession.ts`) creates a row that is born `in_progress` and
// never passes through here; this file only ever moves a row the coach's
// program already put on the device.
//
// Five rules, in the order they matter:
//
// (a) **The local write is synchronous with the tap and independent of the
//     network.** The task's own Risks section: any network dependency in
//     this path undermines the phase's premise. The row flips, the logger
//     opens, and the outbox reaches the server on its own schedule
//     (`offline-sync` §1).
//
// (b) **The session is named by its SERVER id, not by an idempotency key.**
//     The row already exists server-side — `lib/materialise-sessions.ts`
//     created it, with its own deterministic `client_local_id` (DB§14.5).
//     There is nothing to insert, so this is not an upsert and must not be
//     keyed like one: re-keying it on the device's copy of that column
//     would insert a SECOND workout for any row whose stored key is null
//     (`sessions_client_local` is partial, and the column is nullable).
//     `enqueueMutation`'s own key still travels with the entry — `flush.ts`
//     merges it into every payload — and the server accepts and ignores it.
//
// (c) **The outbox id is persisted on the row.** It is the `dependsOn`
//     parent of every set log and of the completion, and a client force-
//     quits mid-workout: held in memory it would not survive the restart,
//     and the sets logged afterwards would name a session the server has
//     never heard of (`lib/outbox/enqueue.ts` rule 2).
//
// (d) **The instant is captured at the tap.** It is `started_at`, and it is
//     the `updated_at` DB§14.3's last-write-wins comparison reads. Taking
//     it at flush time is `offline-sync` §10's "everything timestamped at
//     reconnect".
//
// (e) **The outbox entry is written before the local row**, the same order
//     and for the same reason as the ad-hoc path: if the second write
//     fails, the server still learns the session started and the next
//     prefetch brings the truth back. The other order strands a started row
//     nothing will ever sync.

/** The tRPC path the outbox replays. `apps/api/src/routers/workouts.ts`. */
export const START_PROCEDURE = 'workouts.start';

export interface StartedSession {
  /** `local_workout_sessions.client_local_id` — the id the logger route is opened with. */
  localId: string;
  /**
   * The `outbox.id` of the start, to hang every later mutation in this
   * session off (rule (c)).
   *
   * `null` only when the row was already in progress and carries no stored
   * id — a session an older build started. A caller must then enqueue
   * unchained rather than invent a parent.
   */
  outboxId: string | null;
  /** `started_at`. The stored one when the session was already under way — never moved. */
  startedAt: Date;
}

export interface StartSessionDeps {
  /** `local_workout_sessions.client_local_id`, which is `TodaySessionSummary.localId`. */
  sessionLocalId: string;
  /** Evaluated at the tap, never at mount — rule (d). Injected so the instant is testable. */
  now?: () => Date;
  /** `was_offline` on the analytics event. Nothing about the write itself depends on it. */
  isConnected?: boolean;
  db?: LocalDb;
}

/**
 * Transitions one session to `in_progress` and queues the server's half.
 *
 * Exported separately from the hook so the rules above can be tested
 * without a renderer, the same shape `startAdHocSession` is exported in.
 *
 * Throws when the device holds no such row, or holds one the server has
 * never confirmed — both mean there is no `workoutSessionId` to send, and
 * queuing a mutation that names nothing would retry until it failed for
 * good (`offline-sync` §4).
 */
export async function startSession(deps: StartSessionDeps): Promise<StartedSession> {
  const db = deps.db ?? (await getLocalDb());
  const [row] = await db
    .select()
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, deps.sessionLocalId))
    .limit(1);

  if (!row) {
    throw new Error(`startSession: no local_workout_sessions row for "${deps.sessionLocalId}"`);
  }

  const startedAt = (deps.now ?? (() => new Date()))();

  // The whole of the fourth acceptance criterion. A double tap, and a
  // session resumed after an app kill, both land here: the row already says
  // in_progress, so there is nothing to write and nothing to queue, and the
  // caller gets back the ids it would have got the first time. `completed`
  // and `skipped` take the same exit — Today never offers Start on either
  // (`useTodaySession.ts`'s `TodaySessionPhase`), and a start that reverted
  // one would discard work the client cannot get back.
  if (row.status !== 'scheduled') {
    return {
      localId: row.clientLocalId,
      outboxId: row.startOutboxId,
      startedAt: row.startedAt === null ? startedAt : new Date(row.startedAt),
    };
  }

  if (row.serverId === null) {
    throw new Error(`startSession: session "${deps.sessionLocalId}" has no server id to start`);
  }

  // Rule (e), then rule (b): the payload names the row, and carries no
  // `clientLocalId` — `flush.ts` merges the outbox row's own, which is the
  // only authoritative copy of that value.
  const { outboxId } = await enqueueMutation({
    procedure: START_PROCEDURE,
    payload: { workoutSessionId: row.serverId, startedAt },
  });

  await db
    .update(localWorkoutSessions)
    .set({
      status: 'in_progress',
      startedAt: startedAt.getTime(),
      startOutboxId: outboxId,
      // The device authored this and the server has not confirmed it, so a
      // refresh must not overwrite it (`offline-sync` §5,
      // `lib/prefetch/sessions.ts` rule (c)).
      syncState: 'pending',
      updatedAt: startedAt.getTime(),
    })
    .where(eq(localWorkoutSessions.clientLocalId, row.clientLocalId));

  // Fire-and-forget, after the write, never awaited (`analytics-events` §7).
  // `session_id` is the device identity — the one every later event in this
  // session's funnel carries, and the one an ad-hoc start also reports.
  //
  // Wrapped because `readSessionPayload` throws on a payload that will not
  // parse at all, and by this point the session HAS started: letting that
  // reach the caller would report a successful start as a failure
  // (`analytics-events` §7, "never block a user action").
  try {
    const payload = readSessionPayload(row.payloadJson);
    trackEvent('workout_started', {
      session_id: asUuid(row.clientLocalId),
      ...(payload?.session.assignmentId
        ? { assignment_id: asUuid(payload.session.assignmentId) }
        : {}),
      is_ad_hoc: false,
      exercise_count: payload?.session.exercises.length ?? 0,
      was_offline: deps.isConnected === false,
    });
  } catch {
    // An analytics failure is silent (`ERRORS.md` ER§3).
  }

  return { localId: row.clientLocalId, outboxId, startedAt };
}

export interface UseStartSessionResult {
  /**
   * Resolves to the started session, or `null` when the device could not
   * record it.
   *
   * `null` rather than a rejection for the reason `useStartAdHocSession`
   * gives: the caller is a press handler with nothing useful to do with a
   * thrown error, and the failure it stands for is the local mirror
   * refusing to read or write — the same handle the Today card's own read
   * uses, so the honest recovery is to re-run that read
   * (`ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`).
   */
  start: (sessionLocalId: string) => Promise<StartedSession | null>;
}

export function useStartSession(): UseStartSessionResult {
  const { isConnected } = useConnectivity();

  const start = useCallback(
    async (sessionLocalId: string) => {
      try {
        return await startSession({ sessionLocalId, isConnected });
      } catch (error) {
        // A short code and the shape of the failure, never the message
        // (`observability-ops` §1).
        console.warn('workouts.start_failed', {
          procedure: START_PROCEDURE,
          errorName: error instanceof Error ? error.name : 'unknown',
        });
        return null;
      }
    },
    [isConnected],
  );

  return { start };
}
