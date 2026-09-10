import { toLocalDate } from '@coachos/utils';
import type { UpcomingSession } from 'api/src/features/workouts/upcoming.ts';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';
import {
  serialiseSessionPayload,
  type LocalSessionPayload,
} from '../../../lib/prefetch/sessions.ts';

// `phase-09-workout-logger/today-card/04` — starting a workout that no
// program asked for. Three buttons reach it and there is only ever one of
// them on screen: *Log a workout anyway* (no program, frame `E`), *Log
// something anyway* (rest day, frame `D`), and *Log another workout* (a
// session already finished today, frame `C`).
//
// **today-card's whole contract is: write the row through the outbox, then
// navigate** (`DESIGN-SPEC.md` §3.9). No confirmation, no upfront exercise
// picker, no loading state. The picker was the open question in the task
// file and §0 closed it: an upfront `exercises.search` is a network-shaped
// step in the one flow that has to work in a gym basement, and
// `session-modifications` has to build add-exercise inside the logger for
// assigned sessions regardless.
//
// Five rules this file exists to get right:
//
// (a) **Local first, and the network is never waited on.** The row is in
//     SQLite and the logger is open whether or not there is signal
//     (`offline-sync` §1). The outbox entry is what eventually reaches the
//     server, on its own schedule.
//
// (b) **`enqueueMutation` generates the `client_local_id`, and it is reused
//     verbatim for the local row.** One identity for the optimistic row and
//     the queued mutation, which is the whole of `CLAUDE.md` §25.12: the
//     server upserts on `(client_id, client_local_id)`, so replaying the
//     mutation ten times produces one session, not ten.
//
// (c) **The day boundary comes from `@coachos/utils`.** Never
//     `toISOString().slice(0, 10)`, never a `Date` getter (`CLAUDE.md`
//     §25.5). The zone is the client's own — passed in from
//     `useTodaySession`'s resolved `timeZone` rather than resolved a second
//     time here, so the card and the row it creates can never disagree
//     about which day it is.
//
// (d) **The instant is captured when the client taps**, not at mount and
//     not at flush. It is the session's `started_at` and the `updated_at`
//     DB§14.3's last-write-wins comparison reads; taking it at flush time
//     is `offline-sync` §10's "everything timestamped at reconnect".
//
// (e) **The outbox entry is written before the local row.** If the second
//     write fails, the session still exists — the server will create it and
//     the next prefetch brings it back. The other order would leave a local
//     row nothing will ever sync, which is the one outcome this subsystem
//     may never produce.

/** What the caller needs to open the logger and to chain later mutations to this one. */
export interface StartedAdHocSession {
  /**
   * `local_workout_sessions.client_local_id` — the id
   * `(client)/workout/[sessionId]` is opened with, and the same id
   * `useTodaySession` reports as `TodaySessionSummary.localId`. Deliberately
   * not a server id: an ad-hoc session started offline has none yet, and
   * this one always exists (`lib/prefetch/sessions.ts`'s `localKeyFor`).
   */
  localId: string;
  /**
   * The `outbox.id` of the create. Every mutation belonging to this session
   * — its sets, its completion — must be enqueued with this as `dependsOn`,
   * or the server is asked to log a set against a session it has never heard
   * of (DB§14.2, `lib/outbox/enqueue.ts` rule 1).
   *
   * ⚠️ It is returned rather than stored: `local_workout_sessions` has no
   * column for it, so it survives only as long as this app process does.
   * `session-runtime/01` owns persisting it (that task's third acceptance
   * criterion), because `workouts.start` needs exactly the same thing for
   * assigned sessions and a column added here would be half of its answer.
   */
  outboxId: string;
  /** The instant captured at the tap — `started_at`, and the row's `updated_at`. */
  startedAt: Date;
}

export interface StartAdHocSessionDeps {
  /** The client's own zone. No default: a second resolution is a second answer (rule (c)). */
  timeZone: string;
  /** Evaluated at the tap, never at mount — see rule (d). Injected so the boundary is testable. */
  now?: () => Date;
  /** `was_offline` on the analytics event. Nothing about the write itself depends on it. */
  isConnected?: boolean;
  db?: LocalDb;
}

/** The tRPC path the outbox replays. `apps/api/src/routers/workouts.ts`. */
export const AD_HOC_PROCEDURE = 'workouts.startAdHoc';

/**
 * The prescription slot of `local_workout_sessions.payload_json` for a
 * session that has no prescription.
 *
 * It is a complete, honest `UpcomingSession` with an empty `exercises`
 * array rather than an abbreviated object, for one reason that matters:
 * `readSessionPayload` (`today-card/02`) narrows what it reads, because
 * `lib/prefetch/history.ts` writes a different shape into the same column
 * and the date split between the two prefetchers is not airtight. Its guard
 * requires `session.exercises` and a top-level `exercises` to both be
 * arrays — so an empty payload has to be shaped like a real one, not like
 * `{}`. Every downstream number then degrades through the path task 01
 * already built for a payload it cannot read: no pills, no estimate, no
 * target sets, no progress bar (`components/TodayCard.tsx`).
 */
export function emptyAdHocPayload(session: UpcomingSession): LocalSessionPayload {
  return { session, exercises: [] };
}

/**
 * Creates the session and returns what the caller needs to navigate.
 *
 * Exported separately from the hook so the rules above can be tested
 * without a renderer, the same shape `useTodaySession`'s `resolveState` is
 * exported in.
 */
export async function startAdHocSession(deps: StartAdHocSessionDeps): Promise<StartedAdHocSession> {
  const startedAt = (deps.now ?? (() => new Date()))();
  const scheduledDate = toLocalDate(startedAt, deps.timeZone);

  // Rule (e), and rule (b): this is where the one `client_local_id` for
  // this session comes from. It is never regenerated — not here, and not by
  // the flush loop, which replays the stored row.
  const { outboxId, clientLocalId } = await enqueueMutation({
    procedure: AD_HOC_PROCEDURE,
    // `clientLocalId` is deliberately absent: `flush.ts`'s
    // `buildProcedureInput` merges the outbox row's own id into every
    // payload it sends, and the row is the only place that id is
    // authoritative.
    payload: { scheduledDate, startedAt },
  });

  const db = deps.db ?? (await getLocalDb());

  // `id` is the `client_local_id` rather than a second generated uuid.
  // Before sync there is exactly one identity this row has, and minting a
  // second one that names nothing invites the two being confused — the
  // server's own id arrives later, in `server_id`.
  const session: UpcomingSession = {
    id: clientLocalId,
    clientLocalId,
    // The whole point of the row (DB§5.2): an ad-hoc session references no
    // assignment and no program day.
    assignmentId: null,
    programDayId: null,
    name: null,
    scheduledDate,
    status: 'in_progress',
    startedAt,
    completedAt: null,
    updatedAt: startedAt,
    dayName: null,
    dayNotes: null,
    exercises: [],
  };

  await db.insert(localWorkoutSessions).values({
    id: clientLocalId,
    clientLocalId,
    serverId: null,
    scheduledDate,
    programDayId: null,
    name: null,
    // Creating an ad-hoc session IS starting it — the client is handed
    // straight to the logger and there is no second "Start" anywhere in
    // frame `H`. `session-runtime/01`'s scheduled→in_progress transition
    // is for assigned sessions and never sees this row.
    status: 'in_progress',
    startedAt: startedAt.getTime(),
    completedAt: null,
    payloadJson: serialiseSessionPayload(emptyAdHocPayload(session)),
    // `offline-sync` §5: the device authored this and the server has not
    // confirmed it, so a refresh must not overwrite it
    // (`lib/prefetch/sessions.ts` rule (c) skips a row that is not
    // `'synced'`).
    syncState: 'pending',
    updatedAt: startedAt.getTime(),
  });

  // Fire-and-forget, after the write, never awaited (`analytics-events` §7).
  // `session_id` is the device identity, which is the only one that exists
  // at this point and the one every later event in this session's funnel
  // will carry. No `assignment_id`: an ad-hoc session has none, and
  // `trackEvent` drops an `undefined` rather than sending it.
  trackEvent('workout_started', {
    session_id: asUuid(clientLocalId),
    is_ad_hoc: true,
    exercise_count: 0,
    was_offline: deps.isConnected === false,
  });

  return { localId: clientLocalId, outboxId, startedAt };
}

export interface UseStartAdHocSessionOptions {
  /** The zone `useTodaySession` already resolved. One source, never a second (rule (c)). */
  timeZone: string;
  /** Injected in tests; evaluated at the tap. */
  now?: (() => Date) | undefined;
}

export interface UseStartAdHocSessionResult {
  /**
   * Resolves to the created session, or `null` when the device could not
   * record it.
   *
   * `null` rather than a rejection because the caller is a press handler and
   * has nothing useful to do with a thrown error. The failure it stands for
   * is the local SQLite mirror refusing to write — which is the same handle
   * `useTodaySession`'s read uses, so the honest recovery is to re-run that
   * read: it either succeeds (and the client can simply press again) or
   * fails into the section error `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`
   * already describes. No new error state is introduced here, because no new
   * failure is reachable.
   */
  startAdHoc: () => Promise<StartedAdHocSession | null>;
}

export function useStartAdHocSession(
  options: UseStartAdHocSessionOptions,
): UseStartAdHocSessionResult {
  const { isConnected } = useConnectivity();
  const { timeZone, now } = options;

  const startAdHoc = useCallback(async () => {
    try {
      return await startAdHocSession({ timeZone, isConnected, ...(now ? { now } : {}) });
    } catch (error) {
      // A short code and the shape of the failure, never the message: an
      // error string can carry an echoed payload (`observability-ops` §1).
      console.warn('workouts.ad_hoc_start_failed', {
        procedure: AD_HOC_PROCEDURE,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }, [timeZone, isConnected, now]);

  return { startAdHoc };
}
