import { eq } from 'drizzle-orm';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';

// §8.4's "session state survives app kill mid-workout (local SQLite, §13)"
// — `phase-09-workout-logger/session-runtime/06`, and the feature's own
// highest-stakes correctness requirement.
//
// **What this module is, and is not.** It does not restore anything. Every
// piece of the session's state is already in `coachos.db` the instant the
// client produces it — the `in_progress` transition and its outbox id
// (`hooks/useStartSession.ts`), the exercise position
// (`lib/logger-position.ts`), and every logged set (`set-entry`) — and the
// logger screen reads all of it back on mount from that one source
// (`hooks/useLoggerSession.ts`, `hooks/useExercisePosition.ts`). This module
// answers a narrower question: **is there a session the client was in the
// middle of, and should the app put them back inside it without being
// asked.**
//
// Four rules, in the order they matter:
//
// (a) **No prompt, when the answer is unambiguous.** A session that is
//     `in_progress` with no completion marker is a session the client is
//     in. Asking "resume?" makes the client confirm a fact the device
//     already knows, and the wrong answer loses their place — the task's
//     step 2. So an in-window session is navigated into, silently.
//
// (b) **Staleness is decided against the product's existing number, not a
//     new one.** {@link SESSION_RESUME_WINDOW_MS} is DB§14.5's six-hour
//     ceiling, the same value `apps/api/src/features/workouts/claim.ts`
//     calls `CLAIM_CEILING_MS`: past it the product already considers a
//     session no longer live and lets another device take it without
//     asking. A second, disagreeing threshold for "is this session still
//     the one the client is in" would be the bug. The value is restated
//     rather than imported because that module pulls in `@coachos/db` and
//     cannot cross into the Metro bundle — the same arrangement, and the
//     same reason, as `lib/session-key.ts`'s copied namespace, and the
//     test pins it.
//
// (c) **Stale means "do not navigate", never "discard".** Nothing here
//     writes, completes, skips, or deletes anything. A session left
//     `in_progress` from days ago keeps every set, its position, and its
//     outbox chain; Today still ranks it first (`useTodaySession`'s
//     `pickTodaySession`) and still offers Continue, which is one tap. The
//     only thing withheld is the app choosing a fullscreen focus mode on
//     the client's behalf for a workout they walked away from — which every
//     cold start would otherwise do, forever, until they finished it.
//
// (d) **A row that cannot be aged is not resumed.** `status = 'in_progress'`
//     with no `started_at` is the pairing `useLoggerSession` already reports
//     as not-in-progress and `useTodaySession.resolvePhase` already degrades
//     to `scheduled`. It should not occur; when it does, the honest
//     behaviour is the one the rest of the feature already picked, not a
//     third opinion.

/**
 * How recently a session must have started for the app to re-enter it on its
 * own — rule (b). Six hours, DB§14.5's claim ceiling, restated here because
 * `apps/api`'s copy cannot be imported into the bundle.
 */
export const SESSION_RESUME_WINDOW_MS = 6 * 60 * 60 * 1_000;

/** The fullscreen logger, as `(client)/(tabs)/index.tsx` addresses it. */
export const LOGGER_ROUTE = '/(client)/workout/[sessionId]' as const;

/** The columns the decision reads. A subset of `local_workout_sessions`, so a test needs no payload. */
export interface RecoverableSessionRow {
  /** `local_workout_sessions.client_local_id` — the id the logger route is opened with. */
  clientLocalId: string;
  status: string;
  /** Epoch ms, or `null` for a row nothing has started — rule (d). */
  startedAt: number | null;
}

export type SessionRecovery =
  /** Nothing to go back to. The ordinary launch. */
  | { kind: 'none' }
  /** Re-enter this session's logger now, with no prompt — rule (a). */
  | { kind: 'resume'; sessionLocalId: string; startedAt: Date }
  /**
   * A session is still open but is older than the window. Reported rather
   * than swallowed so the caller can log it, and so the distinction is
   * visible in a test — but the caller navigates nowhere, rule (c).
   */
  | { kind: 'stale'; sessionLocalId: string; startedAt: Date };

/**
 * The whole rule, as a pure function so every branch is testable without a
 * database or a renderer.
 *
 * When the device somehow holds more than one open session — two devices
 * whose rows both reached this one, or an ad-hoc session started beside an
 * assigned one — the most recently started wins. It is the one the client
 * was in.
 */
export function decideRecovery(rows: readonly RecoverableSessionRow[], at: Date): SessionRecovery {
  let best: { sessionLocalId: string; startedAt: number } | null = null;

  for (const row of rows) {
    // Rule (d). Both halves, the same pairing `summariseLoggerSession` requires.
    if (row.status !== 'in_progress' || row.startedAt === null) continue;
    if (best === null || row.startedAt > best.startedAt) {
      best = { sessionLocalId: row.clientLocalId, startedAt: row.startedAt };
    }
  }

  if (best === null) return { kind: 'none' };

  const startedAt = new Date(best.startedAt);
  // Signed, not absolute: a `started_at` in the future is a device whose
  // clock moved backwards, and that session is still the one the client is
  // standing in. Treating the skew as age would lock them out of it.
  const ageMs = at.getTime() - best.startedAt;

  return ageMs > SESSION_RESUME_WINDOW_MS
    ? { kind: 'stale', sessionLocalId: best.sessionLocalId, startedAt }
    : { kind: 'resume', sessionLocalId: best.sessionLocalId, startedAt };
}

export interface CheckForInProgressSessionDeps {
  db?: LocalDb;
  /** Injected so the window is testable; the boundary is untestable without it. */
  now?: () => Date;
}

/**
 * Whether the app should re-enter a session at start, and which one.
 *
 * One indexed read of the local mirror and no network at all — the client
 * whose phone killed the app is the client with no signal, and a recovery
 * that waited on a response would fail exactly when it is needed
 * (`offline-sync` §1).
 *
 * Rejects if the mirror will not answer. The caller logs and carries on: a
 * failed recovery costs the client one tap on Today, and there is nothing
 * useful to show them about it (`ERRORS.md` ER§1.4).
 */
export async function checkForInProgressSession(
  deps: CheckForInProgressSessionDeps = {},
): Promise<SessionRecovery> {
  const db = deps.db ?? (await getLocalDb());

  const rows = await db
    .select({
      clientLocalId: localWorkoutSessions.clientLocalId,
      status: localWorkoutSessions.status,
      startedAt: localWorkoutSessions.startedAt,
    })
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.status, 'in_progress'));

  return decideRecovery(rows, (deps.now ?? (() => new Date()))());
}
