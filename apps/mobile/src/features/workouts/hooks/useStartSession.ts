import { eq } from 'drizzle-orm';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';
import {
  prefetchSessionsAndExercises,
  readSessionPayload,
} from '../../../lib/prefetch/sessions.ts';
import { api } from '../../../lib/trpc.ts';

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

// ─── The claim seam (DB§14.5 mechanism 3, `session-runtime/08`) ──────────
//
// Everything above this line is the local write, and it is unchanged: still
// synchronous with the tap, still independent of the network, rule (a). The
// claim is layered *in front* of it rather than inside it, and that
// arrangement is the whole design.
//
// Four more rules, in the order they matter:
//
// (f) **An offline start is never blocked by a claim check.** The check runs
//     only when `useConnectivity` says the device is online AND the row has
//     a server id to name. With no signal there is no call, no timeout to
//     wait out, and no sheet — the tap writes locally and the outbox settles
//     the claim when the signal returns (`workouts.start` claims on the
//     transition it performs). This is the task's own named risk and the
//     product's central promise; a network dependency here breaks both.
//
// (g) **A claim call that fails is not a refusal.** Only
//     `SESSION_CLAIMED_ELSEWHERE` stops the start. A timeout, a 500, a
//     connection dropped mid-request — every one of them proceeds into the
//     logger unclaimed. The alternative fails *closed* on a client standing
//     in a gym, which `apps/api/src/features/workouts/claim.ts` rule (a)
//     says is the one outcome that outranks correctness here.
//
// (h) **A transfer refetches server truth before the local start.** Taking
//     ownership while holding a stale set list is how the duplicate comes
//     back through a different door — the device re-enqueues sets that
//     already synced. The refetch runs first and the local write second.
//     `prefetchSessionsAndExercises` skips rows this device has unsynced
//     changes to (`lib/prefetch/sessions.ts` rule (c)), which is right here
//     too: the client's own unsynced work is never overwritten by an older
//     server copy.
//
//     **It is best effort.** If it fails the start still proceeds and the
//     caller is told (`caughtUp: false`) so the sheet can say so. Trapping a
//     client behind a retry loop is the failure (h) exists to avoid, not one
//     worth introducing to satisfy it.
//
// (i) **The claim runs on Continue as well as on Start.** Re-entering a
//     paused session is a start action and another device may have taken it
//     meanwhile. `startSession` above returns early for a row already
//     `in_progress`; the claim ahead of it does not.

/** The tRPC path the claim check calls. `apps/api/src/routers/workouts.ts`. */
export const CLAIM_PROCEDURE = 'workouts.claim';

export type StartAttempt =
  | {
      kind: 'started';
      session: StartedSession;
      /** The claim was taken from another device — rule (h) ran. */
      transferred: boolean;
      /**
       * Whether rule (h)'s refetch succeeded. `false` only ever accompanies
       * `transferred: true`, and means the logger is opening without
       * whatever the other device logged most recently.
       */
      caughtUp: boolean;
    }
  /**
   * Another device is actively logging this session and the client has not
   * been asked yet. The caller shows `components/ClaimSheet.tsx`; "Continue
   * here" calls back with `transfer: true`. **Nothing was written locally**,
   * so a client who cancels is exactly where they started.
   */
  | { kind: 'claimed-elsewhere' }
  /** The local mirror refused to read or write (`ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`). */
  | { kind: 'failed' };

/**
 * `workouts.claim`'s answer, narrowed to the one field this file acts on.
 *
 * No instant crosses the wire: the claim is decided against the server's own
 * clock (`packages/schemas/src/workouts.ts`). `at` below is still captured at
 * the tap, but it belongs to `started_at`, which is offline-replayed and
 * genuinely is the device's to report.
 */
export type ClaimCheck = (input: {
  workoutSessionId: string;
  transfer: boolean;
}) => Promise<{ outcome: string }>;

export interface AttemptStartDeps extends StartSessionDeps {
  /** The client answered "Continue here" to a previous `claimed-elsewhere`. */
  transfer?: boolean;
  /** `workouts.claim`. Omitting it — or `isConnected: false` — skips the check entirely. */
  claim?: ClaimCheck;
  /** Rule (h). Defaults to the real prefetch; injected so a test needs no network. */
  refetchServerTruth?: () => Promise<unknown>;
}

/** The session's server id, or `null` for a row the server has never confirmed. */
async function readServerId(db: LocalDb, sessionLocalId: string): Promise<string | null> {
  const [row] = await db
    .select({ serverId: localWorkoutSessions.serverId })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, sessionLocalId))
    .limit(1);

  return row?.serverId ?? null;
}

/**
 * Settles the claim, then starts the session. Exported separately from the
 * hook for the same reason `startSession` is: the rules above are testable
 * without a renderer.
 */
export async function attemptStart(deps: AttemptStartDeps): Promise<StartAttempt> {
  let db: LocalDb;
  try {
    db = deps.db ?? (await getLocalDb());
  } catch (error) {
    console.warn('workouts.start_failed', {
      procedure: START_PROCEDURE,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return { kind: 'failed' };
  }

  // Captured once, at the tap — rule (d). This is `started_at`, which is
  // replayed from the outbox and so genuinely is the device's to report. The
  // claim below deliberately sends no instant: it is a live call and the
  // server times it off its own clock.
  const at = (deps.now ?? (() => new Date()))();

  let transferred = false;
  let caughtUp = true;

  // Rule (f). Each condition is a reason there is nothing to ask the server,
  // never a reason to refuse the client.
  let serverId: string | null = null;
  if (deps.isConnected !== false && deps.claim) {
    try {
      serverId = await readServerId(db, deps.sessionLocalId);
    } catch {
      // The mirror will fail again inside `startSession` below, which is
      // where it becomes a `failed`. Skipping the claim is the right move
      // either way.
      serverId = null;
    }
  }

  if (serverId !== null && deps.claim) {
    try {
      const { outcome } = await deps.claim({
        workoutSessionId: serverId,
        transfer: deps.transfer ?? false,
      });
      transferred = outcome === 'transferred';
    } catch (error) {
      if (getErrorCode(error) === 'SESSION_CLAIMED_ELSEWHERE') {
        return { kind: 'claimed-elsewhere' };
      }
      // Rule (g). Everything else proceeds unclaimed.
      console.warn('workouts.claim_failed', {
        procedure: CLAIM_PROCEDURE,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  // Rule (h) — before the local write, never after it.
  if (transferred) {
    try {
      await (deps.refetchServerTruth ?? (() => prefetchSessionsAndExercises()))();
    } catch (error) {
      caughtUp = false;
      console.warn('workouts.claim_catchup_failed', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  try {
    const session = await startSession({ ...deps, db, now: () => at });
    return { kind: 'started', session, transferred, caughtUp };
  } catch (error) {
    // A short code and the shape of the failure, never the message
    // (`observability-ops` §1).
    console.warn('workouts.start_failed', {
      procedure: START_PROCEDURE,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return { kind: 'failed' };
  }
}

export interface StartOptions {
  /** The client answered "Continue here" on `components/ClaimSheet.tsx`. */
  transfer?: boolean;
}

export interface UseStartSessionResult {
  /**
   * Settles the claim, then starts the session.
   *
   * Resolves to a {@link StartAttempt} rather than rejecting, for the reason
   * `useStartAdHocSession` gives: the caller is a press handler with nothing
   * useful to do with a thrown error. The three outcomes map one-to-one onto
   * what the screen does next — open the logger, show the sheet, or show the
   * section error (`ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`).
   */
  start: (sessionLocalId: string, options?: StartOptions) => Promise<StartAttempt>;
}

export function useStartSession(): UseStartSessionResult {
  const { isConnected } = useConnectivity();
  const claim = api.workouts.claim.useMutation();
  const claimAsync = claim.mutateAsync;

  const start = useCallback(
    (sessionLocalId: string, options?: StartOptions) =>
      attemptStart({
        sessionLocalId,
        isConnected,
        transfer: options?.transfer ?? false,
        claim: (input) => claimAsync(input),
      }),
    [isConnected, claimAsync],
  );

  return { start };
}
