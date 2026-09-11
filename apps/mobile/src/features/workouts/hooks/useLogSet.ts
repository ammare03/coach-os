import { eq } from 'drizzle-orm';
import { useCallback } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';

// `phase-09-workout-logger/set-entry/01` — the write path under the two-tap
// set row. `SetEntryRow` owns the taps; this file owns everything that
// happens after the second one, and its entire job is to make that moment
// cost nothing (`CLAUDE.md` §19: set log → visual confirmation < 100ms).
//
// Six rules, in the order they matter:
//
// (a) **Nothing here awaits the network, and there is no tRPC call in this
//     file at all.** Two local SQLite writes and a return. §19's budget is a
//     budget for a local operation, and the only way to blow it is to put
//     something remote — or something that can block on something remote —
//     between the tap and the row. The set reaching the server is the
//     outbox's problem, on its own schedule (`offline-sync` §1), which is
//     also why online and offline are indistinguishable from the caller's
//     side: the code path is byte for byte the same.
//
// (b) **The outbox entry is written first, and its `clientLocalId` is the
//     local row's.** `enqueueMutation` generates that key exactly once and
//     exposes no parameter to pass a fresh one on a second attempt
//     (`lib/outbox/enqueue.ts`), which is the whole of `offline-sync` §3 —
//     a regenerated key turns one set into one set per retry. Reusing it
//     verbatim for the local row is what makes the device's copy and the
//     server's row the same object under two clocks, and it is what the
//     server's `ON CONFLICT (client_id, client_local_id)` upserts against.
//
//     The order matters for the same reason `useCompleteSession` rule (e)
//     gives: if the second write fails, the server still learns about the
//     set and the next prefetch brings it back. The other order strands a
//     visible row nothing will ever sync — which is the failure a client
//     cannot see and cannot report.
//
// (c) **The set chains to the session's start, never to the previous set.**
//     `local_workout_sessions.start_outbox_id` is the parent (DB§14.2,
//     `lib/outbox/enqueue.ts` rule 2): a set the server saw before the
//     session would name a `client_local_id` it has never heard of. Sets are
//     siblings of each other and flush concurrently, which is correct — each
//     is an independent upsert keyed on its own id, and serialising forty
//     sets behind one another would mean one slow request holds up the whole
//     session (`enqueue.ts` rule 4).
//
//     A session row with no stored parent — one an older build started —
//     queues UNCHAINED rather than hanging off an invented id:
//     `enqueueMutation` throws on a `dependsOn` that names nothing, and a
//     stranded set is worse than an unordered one. Same call
//     `useCompleteSession` makes.
//
// (d) **The instant is captured at the tap.** It is `logged_at`, and it is
//     load-bearing beyond the usual "not at reconnect" rule
//     (`offline-sync` §10): `set_logs_client_exercise` is indexed
//     `(client_id, exercise_id, logged_at DESC)` and answers "last time you
//     did this exercise" — the query this very row will be pre-filled from
//     next week — and the training day a set belongs to is a local calendar
//     day (`CLAUDE.md` §25.5). A basement session re-dated at sync time gets
//     both wrong.
//
// (e) **The session must be one that can take a set.** A set logged against
//     a session the device does not hold would violate
//     `local_set_logs.session_local_id`'s foreign key, and one logged
//     against a session that was never started would queue a mutation the
//     server refuses. Both throw here rather than silently queueing, so the
//     caller can render `ERRORS.md` ER§1.4's local-read failure instead of
//     showing a set that quietly does not exist.
//
// (f) **`set_logged` is fired after both writes, never awaited, and never
//     able to fail the set** (`analytics-events` §7). Ids and counts only:
//     no weight, no reps, no exercise name. Weight and reps are body-adjacent
//     values under `CLAUDE.md` §21.1 and have no business in PostHog, and
//     the event's own declaration in `lib/analytics/events.ts` has no field
//     that could carry them.

/** The tRPC path the outbox replays. `apps/api/src/routers/workouts.ts`. */
export const LOG_SET_PROCEDURE = 'workouts.logSet';

/** One set, as the caller asks for it to be logged. */
export interface LogSetArgs {
  /**
   * `local_workout_sessions.client_local_id` — the id the logger route
   * carries, and the key `local_set_logs.session_local_id` references. Never
   * a server id: an ad-hoc session started offline has none.
   */
  sessionLocalId: string;
  /** A `training.exercises` row — `LoggerSession.payload`'s `exerciseId`. */
  exerciseId: string;
  /** 1-based position within the exercise. The caller renders "Set 3 of 4"; it knows. */
  setNumber: number;
  /** Zero is permitted — a failed attempt, which `set-entry/04`'s flag annotates. */
  reps: number;
  /** Kilograms, always (`CLAUDE.md` §0). Omit for a bodyweight set. */
  weightKg?: number | null;
  /** Ramp-up work. Excluded from volume and from the session's set count. */
  isWarmup?: boolean;
  /**
   * Taken to momentary failure. Accepted now so `set-entry/04` adds a
   * control rather than a signature — but note it travels to the server only:
   * `local_set_logs` has no `is_failure` column yet, so the value lives in
   * the queued payload and not in the device's own render copy. Task 04 adds
   * the column, the DDL, and the drift-test entry together.
   */
  isFailure?: boolean;
  /**
   * `Date.now()` sampled by the caller at the moment of the confirming tap,
   * for `set_logged.entry_ms` — the field that proves §19's budget in the
   * field rather than on a developer's desk. Omitted, the measurement starts
   * here, which under-reports by however long the caller's own handler took.
   */
  tapAtMs?: number;
}

/** What the caller gets back, synchronously enough to render from. */
export interface LoggedSet {
  /**
   * `local_set_logs.client_local_id` — the set's own key, and the one
   * `set-entry/05` re-sends verbatim to edit it and `set-entry/06` names to
   * delete it.
   */
  localId: string;
  /** The `outbox.id` of the queued mutation, for anything that must sync after it. */
  outboxId: string;
  setNumber: number;
  /** `logged_at`, the tap instant — rule (d). */
  loggedAt: Date;
  /** Milliseconds from the tap to both local writes being durable. */
  entryMs: number;
}

export interface LogSetDeps extends LogSetArgs {
  /** Evaluated at the tap, never at mount — rule (d). Injected so the instant is testable. */
  now?: () => Date;
  /** `was_offline` on the analytics event. Nothing about the write itself depends on it. */
  isConnected?: boolean;
  db?: LocalDb;
}

/**
 * Logs one set locally and queues the server's half.
 *
 * Exported separately from the hook so the rules above can be tested without
 * a renderer, the same shape `completeSession` and `startSession` are
 * exported in.
 *
 * Throws when the device holds no such session, and when that session is not
 * in progress — rule (e). Both are `ERRORS.md` ER§1.4 local failures the
 * logger already has a state for; neither is reachable from the set row in
 * an open, in-progress logger.
 */
export async function logSet(deps: LogSetDeps): Promise<LoggedSet> {
  const startedMs = deps.tapAtMs ?? Date.now();
  const db = deps.db ?? (await getLocalDb());

  const [session] = await db
    .select({
      clientLocalId: localWorkoutSessions.clientLocalId,
      status: localWorkoutSessions.status,
      startOutboxId: localWorkoutSessions.startOutboxId,
    })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, deps.sessionLocalId))
    .limit(1);

  if (!session) {
    throw new Error(`logSet: no local_workout_sessions row for "${deps.sessionLocalId}"`);
  }

  if (session.status !== 'in_progress') {
    // The set row only exists inside an open, in-progress logger. Loud
    // rather than silent: queuing a set for a session the server will not
    // accept one for would show work that never lands.
    throw new Error(
      `logSet: session "${deps.sessionLocalId}" is not in progress (${session.status})`,
    );
  }

  const loggedAt = (deps.now ?? (() => new Date()))();
  const weightKg = deps.weightKg ?? null;
  const isWarmup = deps.isWarmup ?? false;

  // Rules (b) and (c). The payload carries no `clientLocalId` — `flush.ts`
  // merges the outbox row's own, which is the only authoritative copy of it.
  const { outboxId, clientLocalId } = await enqueueMutation({
    procedure: LOG_SET_PROCEDURE,
    payload: {
      sessionClientLocalId: session.clientLocalId,
      exerciseId: deps.exerciseId,
      setNumber: deps.setNumber,
      reps: deps.reps,
      // Always sent, `null` included — `set_logs` is device-wins and the
      // server overwrites only what the payload names (`logSetInput`).
      weightKg,
      loggedAt,
      isWarmup,
      isFailure: deps.isFailure ?? false,
    },
    ...(session.startOutboxId === null ? {} : { dependsOn: session.startOutboxId }),
  });

  await db.insert(localSetLogs).values({
    // The device generated this key and has no second id to keep in step
    // with it. Reusing it as the primary key is one fewer value that can
    // disagree with itself, and the row has no server id to hold anyway —
    // the flush loop writes none back.
    id: clientLocalId,
    clientLocalId,
    sessionLocalId: session.clientLocalId,
    exerciseId: deps.exerciseId,
    setNumber: deps.setNumber,
    reps: deps.reps,
    weightKg,
    isWarmup,
    loggedAt: loggedAt.getTime(),
    // The device authored this and the server has not confirmed it, so a
    // refresh must not overwrite it (`offline-sync` §5).
    syncState: 'pending',
  });

  const entryMs = Date.now() - startedMs;

  // Rule (f). Fire-and-forget, after the writes, never awaited. Wrapped
  // because by this point the set IS logged: letting an analytics failure
  // reach the caller would report logged work as a failure (`ERRORS.md` ER§3).
  try {
    trackEvent('set_logged', {
      // The device identity — the same one `workout_started` and
      // `workout_completed` report, which is what makes the three joinable
      // (`ANALYTICS.md` AN§4).
      session_id: asUuid(session.clientLocalId),
      exercise_id: asUuid(deps.exerciseId),
      set_number: deps.setNumber,
      is_warmup: isWarmup,
      // RPE is not part of this task's row (`set-entry/03` adds it); this
      // reports what was actually captured, not what the field could hold.
      had_rpe: false,
      was_offline: deps.isConnected === false,
      entry_ms: entryMs,
    });
  } catch {
    // An analytics failure is silent (`ERRORS.md` ER§3).
  }

  return { localId: clientLocalId, outboxId, setNumber: deps.setNumber, loggedAt, entryMs };
}

export interface UseLogSetResult {
  /**
   * Logs one set and queues the server's half.
   *
   * Rejects only on a local-mirror failure — `ERRORS.md` ER§1.4's
   * `LOCAL_READ_FAILED`, which the logger renders with its existing error
   * state. There is no network outcome to surface: the set is durable the
   * moment this resolves, whatever the radio is doing.
   */
  logSet: (args: LogSetArgs) => Promise<LoggedSet>;
}

export function useLogSet(): UseLogSetResult {
  const { isConnected } = useConnectivity();

  const log = useCallback((args: LogSetArgs) => logSet({ ...args, isConnected }), [isConnected]);

  return { logSet: log };
}
