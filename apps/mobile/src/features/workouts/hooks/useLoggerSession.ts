import { countWorkingSets, totalTargetSets } from '@coachos/utils';
import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { readSessionPayload, type LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';

// `phase-09-workout-logger/session-runtime/02` — the fullscreen logger's
// whole data layer, and the contract tasks 03 through 09 branch on.
//
// Four rules, in the order they matter:
//
// (a) **The local SQLite read is the only source, and it never waits on the
//     network.** The task's first acceptance criterion, and the premise the
//     whole phase rests on: a client is in a gym basement. There is
//     deliberately no tRPC query behind this one — unlike
//     `useTodaySession`, which revalidates Today's row against
//     `workouts.upcoming`, this screen opens a session that is already
//     under way, and a server refresh mid-session could only overwrite the
//     client's own unsynced work (`offline-sync` §5). `lib/prefetch` still
//     keeps the row current; this reads what it wrote.
//
// (b) **The id in the route is the LOCAL key, never the server id.** It is
//     `local_workout_sessions.client_local_id` — `TodaySessionSummary.localId`,
//     which is what `(tabs)/index.tsx` pushes. A session started offline
//     has no server id at all, so keying this read on one would make the
//     ad-hoc path unopenable (`lib/prefetch/sessions.ts`'s `localKeyFor`).
//
// (c) **The payload is superjson, and it may not be a prescription.**
//     `readSessionPayload` is the matching reader and the narrowing one:
//     `lib/prefetch/history.ts` writes `{ session, setLogs }` into the same
//     column. A row it wrote degrades to "no prescription" rather than
//     throwing — the client must still be able to open and log the session
//     in front of them (`useTodaySession` rule (c)).
//
// (d) **Not a TanStack Query**, for `useTodaySession` rule (d)'s reason:
//     `local_workout_sessions` is not server data, it *is* the cache, and a
//     second cache over it gives the screen two copies that disagree the
//     moment the outbox writes.

export type LoggerSessionRow = typeof localWorkoutSessions.$inferSelect;

/** The set-log columns the two `packages/utils` rules read. */
export interface LoggerSetLog {
  reps: number | null;
  weightKg: number | null;
  isWarmup: boolean;
}

/** One session as the logger shell renders it. Every field is derived on device. */
export interface LoggerSession {
  /** `local_workout_sessions.client_local_id` — rule (b). */
  localId: string;
  /** The server id once one exists, for anything that has to name the row server-side. */
  serverId: string | null;
  /**
   * The session's own name, else the program day's label ("Push A"), else
   * `null`. The fallback WORD is the header's decision, not this hook's —
   * an ad-hoc session legitimately has no name and the copy for that is a
   * design call (`LoggerHeader.tsx`).
   */
  name: string | null;
  status: string;
  /**
   * Whether the client is mid-session. Drives the exit control's label, and
   * task 05's keep-awake.
   */
  isInProgress: boolean;
  /**
   * `null` for a session nothing has started — the elapsed clock then has no
   * origin and renders nothing at all.
   */
  startedAt: Date | null;
  /**
   * Prescribed exercises. `0` for an ad-hoc session, and for a row carrying
   * another writer's payload.
   */
  exerciseCount: number;
  /** Prescribed working sets — the `m` in "8 of 22 sets". */
  targetSets: number;
  /**
   * Working sets actually logged. A warm-up is not progress through the
   * plan, so it is not counted here.
   */
  setsLogged: number;
  /**
   * The full denormalised prescription, for task 03's paging. `null` when
   * the row's payload is not one — rule (c).
   */
  payload: LocalSessionPayload | null;
}

/**
 * What the shell renders. **Later tasks in this feature switch on `kind`**,
 * so the union is complete here.
 *
 * `not-found` and `error` are deliberately separate: an id the device does
 * not hold is a recoverable screen (`CLAUDE.md` §9.2), a mirror that
 * refuses to answer is `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED` with a
 * retry. Collapsing them would offer a retry that can never succeed.
 */
export type LoggerSessionState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; error: unknown }
  | { kind: 'session'; session: LoggerSession };

export interface UseLoggerSessionResult {
  state: LoggerSessionState;
  /** The error state's action: re-runs the local read. */
  retry: () => void;
}

/**
 * Everything the shell shows about one session, from its row, its parsed
 * payload, and its logged sets.
 *
 * Exported separately from the hook so the rules above can be tested
 * without a renderer — the shape `useTodaySession`'s `summariseSession` is
 * exported in.
 */
export function summariseLoggerSession(
  row: LoggerSessionRow,
  payload: LocalSessionPayload | null,
  sets: readonly LoggerSetLog[],
): LoggerSession {
  const blocks = [...(payload?.session.exercises ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  return {
    localId: row.clientLocalId,
    serverId: row.serverId,
    name: row.name ?? payload?.session.name ?? payload?.session.dayName ?? null,
    status: row.status,
    // Both halves, deliberately. A row whose status says in-progress but
    // carries no `started_at` cannot be timed, and reporting it as under
    // way would put a clock on screen counting from the epoch.
    isInProgress: row.status === 'in_progress' && row.startedAt !== null,
    startedAt: row.startedAt === null ? null : new Date(row.startedAt),
    exerciseCount: blocks.length,
    targetSets: totalTargetSets(blocks),
    setsLogged: countWorkingSets(sets),
    payload,
  };
}

/** One pass over the local database. `null` means the device holds no such row. */
export async function readLoggerSession(
  db: LocalDb,
  sessionLocalId: string,
): Promise<LoggerSession | null> {
  const [row] = await db
    .select()
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, sessionLocalId))
    .limit(1);

  if (!row) return null;

  const sets = await db
    .select({
      reps: localSetLogs.reps,
      weightKg: localSetLogs.weightKg,
      isWarmup: localSetLogs.isWarmup,
    })
    .from(localSetLogs)
    .where(eq(localSetLogs.sessionLocalId, row.clientLocalId));

  return summariseLoggerSession(row, readSessionPayload(row.payloadJson), sets);
}

export function useLoggerSession(sessionLocalId: string): UseLoggerSessionResult {
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<LoggerSessionState>({ kind: 'loading' });

  const read = useCallback(async (): Promise<LoggerSessionState> => {
    const db = await getLocalDb();
    const session = await readLoggerSession(db, sessionLocalId);
    return session === null ? { kind: 'not-found' } : { kind: 'session', session };
  }, [sessionLocalId]);

  // An effect with a cancellation flag, the same shape `lib/prefetch` and
  // `useTodaySession` use. No skeleton gate: this is one indexed SELECT on
  // an already-open handle, so it resolves inside a frame, and the header
  // reserves its own slots either way.
  useEffect(() => {
    let alive = true;
    void read().then(
      (next) => {
        if (alive) setState(next);
      },
      (error: unknown) => {
        if (alive) setState({ kind: 'error', error });
      },
    );
    return () => {
      alive = false;
    };
  }, [read, reloadToken]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setReloadToken((token) => token + 1);
  }, []);

  return { state, retry };
}
