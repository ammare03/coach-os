import {
  countWorkingSets,
  estimateSessionMinutes,
  formatLocalDate,
  sessionVolumeKg,
  toLocalDate,
  totalTargetSets,
  type CalendarDate,
} from '@coachos/utils';
import type { UpcomingContext } from 'api/src/features/workouts/upcoming.ts';
import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { prefetchExercises } from '../../../lib/prefetch/exercises.ts';
import {
  readSessionPayload,
  readUpcomingContext,
  upcomingDayContext,
  upcomingRange,
  writeSessions,
  writeUpcomingContext,
  type LocalSessionPayload,
} from '../../../lib/prefetch/sessions.ts';
import { useClientTimeZone } from '../../../lib/time-zone/useClientTimeZone.ts';
import { api } from '../../../lib/trpc.ts';

// `phase-09-workout-logger/today-card/01` — the Today screen's whole data
// layer, and the contract tasks `03` and `04` branch on.
//
// Four rules, in the order they matter:
//
// (a) **The local SQLite read is the primary source and never waits on the
//     network.** Not an optimisation — task 01's Risks section calls a card
//     that blocks on a response a violation of the premise this whole phase
//     rests on, and `docs/screens/client-today.md` puts this screen on the
//     cold-start path at <2.0s. The local read runs at mount; the tRPC
//     query is stale-while-revalidate behind it and can never blank the
//     card when it fails (`UI-UX.md` §UX4.2's offline row).
//
// (b) **The day boundary comes from `@coachos/utils`.** Never
//     `toISOString().slice(0, 10)`, never a `Date` getter — `CLAUDE.md`
//     §25.5's named pitfall, and `lib/prefetch/sessions.ts` rule (a). The
//     zone comes from `lib/time-zone`'s single resolver — the client's own
//     stored `users.timezone` from `me.get` once it resolves, and the
//     device's until then — which is the SAME resolver the prefetch that
//     wrote these rows used (`docs/UNFORGET.md` S32). Reading `me.get`
//     directly here was half of that bug: the reader and the writer were
//     two sources for one fact. `now` is injectable so the boundary is
//     testable at all.
//
// (c) **The payload is superjson, never `JSON.parse`.** `readSessionPayload`
//     is the matching reader and the only one — plain JSON degrades
//     `startedAt`/`completedAt` to strings, which is `offline-sync` §10's
//     "everything timestamped at reconnect" wearing a different hat. It
//     also narrows: `lib/prefetch/history.ts` writes a different payload
//     into the same column. `today-card/02` found the date split between
//     the two prefetchers was not airtight across a midnight or a
//     device/user zone difference; the writer side of that is fixed, and
//     this stays as defence in depth against a row an older build wrote.
//
// (d) **The local read is deliberately not a TanStack Query.**
//     `code-conventions` §5 routes SERVER data through TanStack Query;
//     `local_workout_sessions` is not server data, it *is* the cache, and a
//     second cache over it gives the screen two copies that disagree the
//     moment the outbox writes. It runs in an effect with a cancellation
//     flag — the same shape `lib/prefetch` uses.

/** Today's session as the card renders it. Every field is derived on device. */
export interface TodaySessionSummary {
  /**
   * `local_workout_sessions.client_local_id` — the id the logger route is
   * opened with. Deliberately not the server id: a session started offline
   * has none yet, and the local key is the one that always exists
   * (`lib/prefetch/sessions.ts`'s `localKeyFor`).
   */
  localId: string;
  /** The server id once one exists, for anything that has to name the row server-side. */
  serverId: string | null;
  /** The session's own name, else the program day's label ("Push A"), else null. */
  name: string | null;
  exerciseCount: number;
  /** Prescribed working sets — the `m` in "Set 8 of 22". */
  targetSets: number;
  /** `null` when it cannot be computed. Omit the segment; never render `~— min`. */
  estimatedMinutes: number | null;
  /** The first three prescribed exercise names, in prescribed order. */
  previewExerciseNames: string[];
  /** How many prescribed exercises the preview does not name — the `+N more` pill. */
  remainingExerciseCount: number;
}

/**
 * Which of the hero's three session frames applies. A nested discriminated
 * union under one `kind` rather than three top-level kinds, and that is a
 * decision rather than a shortcut:
 *
 * - All three render the same anatomy over the same row and open the same
 *   route, so three kinds would make tasks 03/04 repeat identical `session`
 *   handling three times.
 * - The fields that differ genuinely exist in one phase each — `startedAt`
 *   is meaningless before a session starts and `completedAt` before it
 *   finishes — so they are narrowed here instead of shipping as four
 *   nullable fields no caller can prove are set.
 *
 * `skipped` is deliberately absent: a skipped session is never surfaced on
 * Today (`docs/screens/client-today.md`'s missed-session rule, `COPY.md`
 * CO§2), so `pickTodaySession` never returns one.
 */
export type TodaySessionPhase =
  | { phase: 'scheduled' }
  | { phase: 'in-progress'; startedAt: Date; setsLogged: number }
  | {
      phase: 'completed';
      completedAt: Date;
      setsLogged: number;
      /** Kilograms, always. `formatWeight` at the render edge owns the unit. */
      volumeKg: number | null;
      durationSeconds: number | null;
    };

/**
 * The header's inputs (frame `I`). Every field degrades on its own — the
 * sub-line drops segments and never invents `Week — of —` or `No coach`.
 */
export interface TodayHeaderContext {
  /** `EEEE, d MMM` in the client's own zone. No data dependency; always present. */
  dateLabel: string;
  /** Today, client-local. What the local read and the query key are built on. */
  date: CalendarDate;
  programName: string | null;
  weekNumber: number | null;
  totalWeeks: number | null;
  /** The coach's first name, or null for a coachless client (`account-lifecycle/06`). */
  coachFirstName: string | null;
}

/**
 * What the card renders. **Tasks `03` and `04` switch on `kind` and are
 * forbidden from editing this file**, so the union is complete here: every
 * frame `A`–`G` has a member, and `rest-day`/`no-program` carry the exact
 * fields their copy varies on.
 */
export type TodaySessionState =
  /** Frame `F`. `showSkeleton` is DESIGN-SPEC §3.6's 250ms gate, decided here so the card owns no timer. */
  | { kind: 'loading'; showSkeleton: boolean }
  /** Frame `G` — `LOCAL_READ_FAILED` (`ERRORS.md` ER§1.4). Only the local read reaches this. */
  | { kind: 'error'; error: unknown }
  /** Frames `A`/`B`/`C`. */
  | { kind: 'session'; session: TodaySessionSummary; phase: TodaySessionPhase }
  /**
   * Frame `D` — `today-card/03` owns the rendering. `isRestDay` separates a
   * programmed rest day (chip "Rest day") from a day the program leaves
   * unprogrammed (chip "Nothing scheduled"): DESIGN-SPEC §3.4's one string
   * swap, not a second state.
   */
  | { kind: 'rest-day'; isRestDay: boolean }
  /** Frame `E` — `today-card/03` owns the rendering. `hasCoach` picks §3.5's body variant. */
  | { kind: 'no-program'; hasCoach: boolean };

export interface UseTodaySessionResult {
  state: TodaySessionState;
  header: TodayHeaderContext;
  /**
   * The zone every date and time on this screen is resolved in — the
   * client's own stored `users.timezone` once anything has resolved it,
   * the device's until then, and always whatever `lib/time-zone`'s
   * resolver is answering. Exposed because the card formats a wall-clock
   * time ("Finished at 6:12 pm") and must not reach for `Intl` itself.
   */
  timeZone: string;
  /** Frame `G`'s action: re-runs the local read and the background refetch. */
  retry: () => void;
}

export interface UseTodaySessionOptions {
  /** Injected so the day boundary is testable; `CLAUDE.md` §25.5 stays broken when it isn't. */
  now?: Date | undefined;
}

/** DESIGN-SPEC §3.6 — below this the stage renders nothing, so a sub-frame read never flickers. */
export const SKELETON_DELAY_MS = 250;

/** The prototype names three exercises and counts the rest (`+N more`). */
const PREVIEW_EXERCISE_COUNT = 3;

/** The format frame `I` draws: "Tuesday, 16 Aug". */
const DATE_FORMAT = 'EEEE, d MMM';

type LocalSessionRow = typeof localWorkoutSessions.$inferSelect;

/**
 * Which row is "today's session" when the day holds more than one.
 *
 * One assigned session per day is the normal case, but `today-card/04` adds
 * an ad-hoc row on the same `scheduled_date`, so the choice is decided once
 * here rather than by whichever row the query happened to return first. The
 * order is what the client would answer if asked: something in progress
 * beats something not started, which beats something already finished.
 * `skipped` is never today's session (see `TodaySessionPhase`).
 */
export function pickTodaySession(rows: readonly LocalSessionRow[]): LocalSessionRow | null {
  const RANK: Record<string, number> = { in_progress: 0, scheduled: 1, completed: 2 };
  let best: LocalSessionRow | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const rank = RANK[row.status];
    if (rank === undefined) continue; // 'skipped', or a status this build predates
    const isBetter =
      rank < bestRank || (rank === bestRank && row.updatedAt > (best?.updatedAt ?? 0));
    if (isBetter) {
      best = row;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Everything the card shows about a session, from the row and its superjson
 * payload.
 *
 * `payload` is nullable because `local_workout_sessions.payload_json` has a
 * second writer: `lib/prefetch/history.ts` puts `{ session, setLogs }` in
 * the same column and the two divide it by date, each from its own clock
 * and zone (`readSessionPayload`). When the division slips, the row is
 * still today's session and the client must still be able to open it — so
 * the prescription is omitted rather than the card refusing to render.
 * Every prescribed number degrades to its own "nothing to show" value, the
 * same ones an empty block list produces.
 */
export function summariseSession(
  row: LocalSessionRow,
  payload: LocalSessionPayload | null,
): TodaySessionSummary {
  const blocks = [...(payload?.session.exercises ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const nameById = new Map(
    (payload?.exercises ?? []).map((exercise) => [exercise.id, exercise.name]),
  );
  // A name the cache does not hold drops its pill rather than rendering a
  // uuid — the payload always carries the exercises its own blocks
  // reference, so this only fires against a cache an older build wrote.
  const names = blocks
    .map((block) => nameById.get(block.exerciseId))
    .filter((name): name is string => name !== undefined);

  return {
    localId: row.clientLocalId,
    serverId: row.serverId,
    name: row.name ?? payload?.session.name ?? payload?.session.dayName ?? null,
    exerciseCount: blocks.length,
    targetSets: totalTargetSets(blocks),
    estimatedMinutes: estimateSessionMinutes(blocks),
    previewExerciseNames: names.slice(0, PREVIEW_EXERCISE_COUNT),
    remainingExerciseCount: Math.max(0, blocks.length - PREVIEW_EXERCISE_COUNT),
  };
}

/** The logged sets of one session, in the shape the two `packages/utils` rules read. */
async function readSetLogs(db: LocalDb, sessionLocalId: string) {
  return db
    .select({
      reps: localSetLogs.reps,
      weightKg: localSetLogs.weightKg,
      isWarmup: localSetLogs.isWarmup,
    })
    .from(localSetLogs)
    .where(eq(localSetLogs.sessionLocalId, sessionLocalId));
}

/**
 * `scheduled` costs no second query — the set-log read only happens once a
 * session has actually been started, which is also the only time it has
 * anything to return.
 *
 * A row whose status says in-progress or completed but carries no matching
 * timestamp degrades to `scheduled` rather than rendering "started NaN min
 * ago". That pairing should not occur; if it does, the honest card is the
 * one that still starts the workout.
 */
export async function resolvePhase(db: LocalDb, row: LocalSessionRow): Promise<TodaySessionPhase> {
  if (row.status === 'in_progress' && row.startedAt !== null) {
    const sets = await readSetLogs(db, row.clientLocalId);
    return {
      phase: 'in-progress',
      startedAt: new Date(row.startedAt),
      setsLogged: countWorkingSets(sets),
    };
  }

  if (row.status === 'completed' && row.completedAt !== null) {
    const sets = await readSetLogs(db, row.clientLocalId);
    return {
      phase: 'completed',
      completedAt: new Date(row.completedAt),
      setsLogged: countWorkingSets(sets),
      volumeKg: sessionVolumeKg(sets),
      durationSeconds:
        row.startedAt === null
          ? null
          : Math.max(0, Math.round((row.completedAt - row.startedAt) / 1000)),
    };
  }

  return { phase: 'scheduled' };
}

/** What one pass over the local database found. Never carries a header — that is composed above. */
interface LocalRead {
  session: { summary: TodaySessionSummary; phase: TodaySessionPhase } | null;
  context: UpcomingContext | null;
}

type LocalReadState =
  | { status: 'loading' }
  | { status: 'ready'; read: LocalRead }
  | { status: 'error'; error: unknown };

export function useTodaySession(options: UseTodaySessionOptions = {}): UseTodaySessionResult {
  // All three fire in parallel at mount. `useClientTimeZone`'s `me.get` and
  // `clientApp.coach` are shared TanStack Query cache entries the rest of
  // the app already subscribes to, so neither is a new round trip in
  // practice.
  const coach = api.clientApp.coach.useQuery();

  const nowOption = options.now;
  // Computed once per mount with no option passed. A day that rolls over
  // while the app sits foregrounded is not handled here and does not need
  // to be: the screen re-reads on focus, and the prefetch that owns the
  // range runs nightly (`phase-08-offline-core/prefetch/03`).
  const now = useMemo(() => nowOption ?? new Date(), [nowOption]);
  // Rule (b): the one resolver, not a second read of `me.get`. This is the
  // same value `lib/prefetch/scheduler.ts` wrote these rows against.
  const timeZone = useClientTimeZone();
  const today = toLocalDate(now, timeZone);
  const range = useMemo(() => upcomingRange(now, timeZone), [now, timeZone]);

  const [reloadToken, setReloadToken] = useState(0);
  const [local, setLocal] = useState<LocalReadState>({ status: 'loading' });
  // Which read the 250ms gate has elapsed for. A token rather than a
  // boolean so `showSkeleton` is DERIVED and never has to be reset — a
  // synchronous `setState` in an effect body is the cascading render
  // `react-hooks/set-state-in-effect` forbids, and a retry bumps the token
  // so a previous read's expired timer cannot arm the next one's skeleton.
  const [skeletonArmedFor, setSkeletonArmedFor] = useState<number | null>(null);

  const upcoming = api.workouts.upcoming.useQuery(range, { retry: 1 });

  const readLocal = useCallback(async (): Promise<LocalRead> => {
    const db = await getLocalDb();
    const rows = await db
      .select()
      .from(localWorkoutSessions)
      .where(eq(localWorkoutSessions.scheduledDate, today));
    const context = await readUpcomingContext(db);
    const row = pickTodaySession(rows);
    if (!row) return { session: null, context };

    const payload = readSessionPayload(row.payloadJson);
    return {
      session: { summary: summariseSession(row, payload), phase: await resolvePhase(db, row) },
      context,
    };
  }, [today]);

  useEffect(() => {
    let alive = true;
    void readLocal().then(
      (read) => {
        if (alive) setLocal({ status: 'ready', read });
      },
      (error: unknown) => {
        if (alive) setLocal({ status: 'error', error });
      },
    );
    return () => {
      alive = false;
    };
  }, [readLocal, reloadToken]);

  // Stale-while-revalidate: whatever the server just said is written into
  // the same cache the read above uses, then the read is re-run. Reusing
  // `writeSessions`/`prefetchExercises`/`writeUpcomingContext` rather than
  // writing rows here keeps `offline-sync` §5's rule in one place — a row
  // the device has unsynced changes to is skipped, not clobbered.
  //
  // `dataUpdatedAt` is the guard against a write→re-read→write loop: a
  // response already persisted is never persisted twice.
  const persistedAt = useRef(0);
  useEffect(() => {
    const data = upcoming.data;
    if (!data || upcoming.dataUpdatedAt === persistedAt.current) return;
    persistedAt.current = upcoming.dataUpdatedAt;

    let alive = true;
    void (async () => {
      const db = await getLocalDb();
      await writeSessions(db, data.sessions, data.exercises);
      await prefetchExercises(data, { db });
      await writeUpcomingContext(db, data.context);
      if (alive) setReloadToken((token) => token + 1);
    })().catch(() => {
      // A cache write that fails leaves the screen on what it already read.
      // Never an error state: the client can still start the workout in
      // front of them, which is the only thing this screen owes them.
    });

    return () => {
      alive = false;
    };
  }, [upcoming.data, upcoming.dataUpdatedAt]);

  // DESIGN-SPEC §3.6's gate. The read is one indexed SELECT on an open
  // handle, so it resolves inside a frame and a skeleton would be a
  // flicker; only a first launch (handle opening or migrating) gets here.
  const isLoading = local.status === 'loading';
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setSkeletonArmedFor(reloadToken), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isLoading, reloadToken]);

  const showSkeleton = isLoading && skeletonArmedFor === reloadToken;

  const day = local.status === 'ready' ? upcomingDayContext(local.read.context, today) : null;
  const context = local.status === 'ready' ? local.read.context : null;

  const header: TodayHeaderContext = {
    // The one line with no data dependency, which is why the header renders
    // while the card is still a skeleton (frame `F`).
    dateLabel: formatLocalDate(now, timeZone, DATE_FORMAT),
    date: today,
    programName: context?.programName ?? null,
    weekNumber: day?.weekNumber ?? null,
    totalWeeks: context?.totalWeeks ?? null,
    coachFirstName: firstName(coach.data?.name),
  };

  return {
    state: resolveState({
      local,
      today,
      showSkeleton,
      // Only an answered `clientApp.coach` may say a client has no coach.
      // While it is loading or failed the copy assumes one, because
      // asserting "you don't have a coach right now" to someone who does is
      // the worse of the two wrong answers (`COPY.md` CO§3).
      hasCoach: coach.isSuccess ? coach.data !== null : true,
      revalidating: upcoming.isPending,
    }),
    header,
    timeZone,
    retry: () => {
      void upcoming.refetch();
      setLocal({ status: 'loading' });
      setReloadToken((token) => token + 1);
    },
  };
}

interface ResolveStateInput {
  local: LocalReadState;
  today: CalendarDate;
  showSkeleton: boolean;
  hasCoach: boolean;
  /** Whether the background `workouts.upcoming` query has yet to answer. */
  revalidating: boolean;
}

/**
 * The whole state machine, extracted so it can be tested without a
 * renderer. Exported for the same reason.
 */
export function resolveState(input: ResolveStateInput): TodaySessionState {
  const { local, today, showSkeleton, hasCoach, revalidating } = input;

  if (local.status === 'loading') return { kind: 'loading', showSkeleton };
  if (local.status === 'error') return { kind: 'error', error: local.error };

  const { session, context } = local.read;
  if (session) return { kind: 'session', session: session.summary, phase: session.phase };

  // No session row for today. Without the context object that is ambiguous
  // between a rest day, an unprogrammed day, and no program at all — which
  // is exactly the API gap DESIGN-SPEC §5.1 closes.
  if (context === null) {
    // Nothing has ever been prefetched onto this device. Hold the loading
    // state while the first revalidation is still in flight rather than
    // telling a client with a program that they have none; once it answers
    // (or fails) `no-program` is the honest fallback, and it still offers
    // the ad-hoc action, so it is never a dead end.
    return revalidating ? { kind: 'loading', showSkeleton } : { kind: 'no-program', hasCoach };
  }

  if (!context.hasActiveAssignment) return { kind: 'no-program', hasCoach };

  const day = upcomingDayContext(context, today);
  return { kind: 'rest-day', isRestDay: day?.isRestDay ?? false };
}

/**
 * "with Marcus" — the coach's own first name, never their business name.
 * Returns null for anything that leaves nothing to show, so the header
 * drops the segment rather than rendering an empty one.
 */
function firstName(name: string | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
