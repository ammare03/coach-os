import { renderHook, waitFor } from '@testing-library/react-native';
import type { UpcomingWorkouts } from 'api/src/features/workouts/upcoming.ts';
import { eq, sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { buildHistorySession } from '../../../lib/prefetch/__fixtures__/history.ts';
import {
  buildBlock,
  buildContext,
  buildDayContext,
  buildExercise,
  buildSession,
} from '../../../lib/prefetch/__fixtures__/upcoming.ts';
import { writeHistorySessions } from '../../../lib/prefetch/history.ts';
import {
  prefetchSessionsAndExercises,
  resetPrefetchStateForTests,
} from '../../../lib/prefetch/sessions.ts';
import { useTodaySession, type TodaySessionState } from '../hooks/useTodaySession.ts';

// `phase-09-workout-logger/today-card/02` — the whole loop, end to end and
// in one process: `prefetch/01` fetches, writes real rows into a real
// `local_workout_sessions` through Drizzle, and then `today-card/01`'s hook
// reads them back and produces exactly what the card renders.
//
// Nothing between the two is stubbed. The only two seams are the ones that
// cannot exist under Jest at all: `expo-sqlite`'s native module (the
// hand-built fake every offline suite already runs against) and the tRPC
// react client (the network). Everything in between — the superjson
// payload, the epoch-ms columns, the `meta.upcoming_context` round trip,
// the day boundary, and rule (c)'s device-wins skip — is the real code.
//
// This is the task's third acceptance criterion, and the reason the other
// two can be checked at all: a field-name or nullability drift between what
// prefetch writes and what the hook reads shows up here as a failing
// assertion rather than as a blank card on a phone in a gym.

jest.mock('expo-sqlite', () =>
  require('../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

let mockMe: { timezone: string } | undefined;
let mockCoach: { name: string } | null | undefined;
let mockCoachSuccess = true;
let mockUpcomingData: UpcomingWorkouts | undefined;
let mockUpcomingUpdatedAt = 0;
let mockUpcomingPending = true;
const mockUpcomingInputs: { from: string; to: string }[] = [];
const mockRefetch = jest.fn();

// Only the network is faked. `workouts.upcoming` is reached here through
// the same `api.workouts.upcoming` path the prefetch fetcher calls, which
// is the integration this file's second acceptance criterion is about.
jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    me: { get: { useQuery: () => ({ data: mockMe }) } },
    clientApp: {
      coach: { useQuery: () => ({ data: mockCoach, isSuccess: mockCoachSuccess }) },
    },
    workouts: {
      upcoming: {
        useQuery: (input: { from: string; to: string }) => {
          mockUpcomingInputs.push(input);
          return {
            data: mockUpcomingData,
            dataUpdatedAt: mockUpcomingUpdatedAt,
            isPending: mockUpcomingPending,
            refetch: mockRefetch,
          };
        },
      },
    },
  },
}));

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

/** 11:30 on 15 Aug 2026 in Kolkata — an ordinary mid-morning, no boundary in play. */
const NOW = new Date('2026-08-15T06:00:00.000Z');
const ZONE = 'Asia/Kolkata';
const TODAY = '2026-08-15';

/** Four prescribed blocks, so the preview names three and counts one. */
const BLOCKS = [
  buildBlock({ programExerciseId: 'b1', exerciseId: 'e1', orderIndex: 1, targetSets: 4 }),
  buildBlock({
    programExerciseId: 'b2',
    exerciseId: 'e2',
    orderIndex: 2,
    targetSets: 3,
    targetRestSeconds: 90,
  }),
  buildBlock({
    programExerciseId: 'b3',
    exerciseId: 'e3',
    orderIndex: 3,
    targetSets: 3,
    targetRestSeconds: 90,
  }),
  buildBlock({
    programExerciseId: 'b4',
    exerciseId: 'e4',
    orderIndex: 4,
    targetSets: 3,
    targetRestSeconds: 60,
  }),
];

const EXERCISES = [
  buildExercise({ id: 'e1', name: 'Back squat' }),
  buildExercise({ id: 'e2', name: 'Bench press' }),
  buildExercise({ id: 'e3', name: 'Barbell row' }),
  buildExercise({ id: 'e4', name: 'Lat pulldown' }),
];

function upcomingResponse(overrides: Partial<UpcomingWorkouts> = {}): UpcomingWorkouts {
  return {
    sessions: [buildSession({ scheduledDate: TODAY, exercises: BLOCKS })],
    exercises: EXERCISES,
    context: buildContext({
      days: [
        buildDayContext({ date: TODAY }),
        buildDayContext({ date: '2026-08-16', dayName: 'Pull A' }),
      ],
    }),
    ...overrides,
  };
}

/** Runs the real prefetch against the real local database. Only the fetch is stubbed. */
async function runPrefetch(response: UpcomingWorkouts, at: Date = NOW, zone: string = ZONE) {
  return prefetchSessionsAndExercises({
    now: at,
    timeZone: zone,
    fetchUpcoming: jest.fn(async () => response),
  });
}

function renderToday(at: Date = NOW) {
  return renderHook(() => useTodaySession({ now: at }));
}

function expectSession(state: TodaySessionState) {
  if (state.kind !== 'session') {
    throw new Error(`expected a session state, got "${state.kind}"`);
  }
  return state;
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
  resetPrefetchStateForTests();
  mockUpcomingInputs.length = 0;
  mockRefetch.mockClear();
  mockMe = { timezone: ZONE };
  mockCoach = { name: 'Marcus Webb' };
  mockCoachSuccess = true;
  // The default is the offline case: nothing has answered from the server,
  // so everything the card shows came off the device.
  mockUpcomingData = undefined;
  mockUpcomingUpdatedAt = 0;
  mockUpcomingPending = true;
});

describe('prefetch to local SQLite to the Today card, with no network in between', () => {
  it('renders every field of a scheduled session from exactly what prefetch wrote', async () => {
    const written = await runPrefetch(upcomingResponse());
    expect(written).toMatchObject({ inserted: 1, skippedUnsynced: 0, exercisesInserted: 4 });

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('session'));

    const state = expectSession(result.current.state);
    expect(state.session).toEqual({
      localId: 'local-1',
      serverId: 'session-1',
      name: 'Push A',
      exerciseCount: 4,
      targetSets: 13,
      estimatedMinutes: 30,
      previewExerciseNames: ['Back squat', 'Bench press', 'Barbell row'],
      remainingExerciseCount: 1,
    });
    expect(state.phase).toEqual({ phase: 'scheduled' });

    // The header's every input, from the cached context and nothing else.
    expect(result.current.header).toEqual({
      dateLabel: 'Saturday, 15 Aug',
      date: TODAY,
      programName: 'Hypertrophy Block 2',
      weekNumber: 6,
      totalWeeks: 12,
      coachFirstName: 'Marcus',
    });
    expect(result.current.timeZone).toBe(ZONE);

    unmount();
  });

  it('asks the server for the same range prefetch asked for, through the same procedure', async () => {
    await runPrefetch(upcomingResponse());

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('session'));

    // `prefetch/01` calls `workouts.upcoming` with `upcomingRange(now, zone)`;
    // the hook's background revalidation builds its input with the same
    // helper. Two different ranges here would mean two different reads over
    // the same rows — the duplicate this task exists to rule out.
    expect(mockUpcomingInputs[0]).toEqual({ from: TODAY, to: '2026-08-16' });

    unmount();
  });

  it('caches every referenced exercise, and keeps the demo URL reachable from the row', async () => {
    await runPrefetch(upcomingResponse());

    const db = await getLocalDb();
    const cached = db.all<Record<string, unknown>>(sql`SELECT * FROM local_exercises_cache`);
    expect(cached.map((row) => row.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4']);

    // The demo URL rides in the session payload rather than the cache table
    // (`lib/prefetch/exercises.ts` decision 2), so the loop only closes if
    // the row the hook reads still carries it.
    const [row] = db.all<Record<string, unknown>>(
      sql`SELECT payload_json FROM local_workout_sessions`,
    );
    expect(String(row?.payload_json)).toContain('https://r2.test/demos/back-squat.mp4');
  });

  it('shows a rest day, which has no session row to hang the answer on', async () => {
    await runPrefetch(
      upcomingResponse({
        sessions: [],
        exercises: [],
        context: buildContext({
          days: [
            buildDayContext({ date: TODAY, isRestDay: true, dayName: 'Rest' }),
            buildDayContext({ date: '2026-08-16', dayName: 'Pull A' }),
          ],
        }),
      }),
    );

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('rest-day'));

    expect(result.current.state).toEqual({ kind: 'rest-day', isRestDay: true });
    // The header keeps working on a rest day: there is no session, but there
    // is still a program.
    expect(result.current.header).toMatchObject({
      programName: 'Hypertrophy Block 2',
      weekNumber: 6,
      totalWeeks: 12,
    });

    unmount();
  });

  it('shows no-program when the client has no active assignment', async () => {
    await runPrefetch(
      upcomingResponse({
        sessions: [],
        exercises: [],
        context: {
          hasActiveAssignment: false,
          programName: null,
          totalWeeks: null,
          days: [
            { date: TODAY, isRestDay: false, weekNumber: null, dayName: null },
            { date: '2026-08-16', isRestDay: false, weekNumber: null, dayName: null },
          ],
        },
      }),
    );

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('no-program'));

    expect(result.current.state).toEqual({ kind: 'no-program', hasCoach: true });
    expect(result.current.header).toMatchObject({
      programName: null,
      weekNumber: null,
      totalWeeks: null,
    });

    unmount();
  });

  it('lets the device win over the server for a session started offline', async () => {
    await runPrefetch(upcomingResponse());

    // The client started the session with no signal: the row is now
    // in-progress, unsynced, and carries two working sets and a warm-up.
    const db = await getLocalDb();
    const startedAt = new Date('2026-08-15T05:40:00.000Z');
    await db
      .update(localWorkoutSessions)
      .set({ status: 'in_progress', startedAt: startedAt.getTime(), syncState: 'pending' })
      .where(eq(localWorkoutSessions.clientLocalId, 'local-1'));
    for (const [index, isWarmup] of [true, false, false].entries()) {
      await db.insert(localSetLogs).values({
        id: `set-${String(index)}`,
        clientLocalId: `set-local-${String(index)}`,
        sessionLocalId: 'local-1',
        exerciseId: 'e1',
        setNumber: index + 1,
        reps: 6,
        weightKg: 62.5,
        isWarmup,
        loggedAt: startedAt.getTime(),
        syncState: 'pending',
      });
    }

    // Prefetch runs again and the server still believes the session is
    // scheduled. `offline-sync` §5: the device was there, the server was not.
    const second = await runPrefetch(upcomingResponse());
    expect(second).toMatchObject({ inserted: 0, updated: 0, skippedUnsynced: 1 });

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('session'));

    const state = expectSession(result.current.state);
    expect(state.phase).toEqual({ phase: 'in-progress', startedAt, setsLogged: 2 });
    // The prescription still renders: the skip protected the client's own
    // columns without costing them the coach's programming.
    expect(state.session.targetSets).toBe(13);

    unmount();
  });

  it("assigns a 00:30 session to the client's own local day, in either direction", async () => {
    // 19:00 UTC is 00:30 the next morning in Kolkata and still the previous
    // afternoon in New York — `CLAUDE.md` §25.5's named pitfall, at the one
    // instant where getting it wrong shows the wrong day's workout.
    const at = new Date('2026-08-14T19:00:00.000Z');

    await runPrefetch(upcomingResponse(), at, ZONE);
    // The 14th's session, which the Kolkata range never covered, written as
    // the previous local day's prefetch would have written it.
    await runPrefetch(
      upcomingResponse({
        sessions: [
          buildSession({
            id: 'session-0',
            clientLocalId: 'local-0',
            scheduledDate: '2026-08-14',
            dayName: 'Pull A',
            exercises: [buildBlock({ exerciseId: 'e1', orderIndex: 1, targetSets: 2 })],
          }),
        ],
      }),
      new Date('2026-08-14T06:00:00.000Z'),
      ZONE,
    );

    const kolkata = renderToday(at);
    await waitFor(() => expect(kolkata.result.current.state.kind).toBe('session'));
    expect(expectSession(kolkata.result.current.state).session.localId).toBe('local-1');
    expect(kolkata.result.current.header.date).toBe(TODAY);
    expect(mockUpcomingInputs[0]).toEqual({ from: TODAY, to: '2026-08-16' });
    kolkata.unmount();

    mockMe = { timezone: 'America/New_York' };
    mockUpcomingInputs.length = 0;

    const newYork = renderToday(at);
    await waitFor(() => expect(newYork.result.current.state.kind).toBe('session'));
    expect(expectSession(newYork.result.current.state).session.localId).toBe('local-0');
    expect(newYork.result.current.header.date).toBe('2026-08-14');
    expect(mockUpcomingInputs[0]).toEqual({ from: '2026-08-14', to: '2026-08-15' });
    newYork.unmount();
  });

  it("survives the history prefetcher owning today's row", async () => {
    // `lib/prefetch/history.ts` writes a DIFFERENT payload into the same
    // `payload_json` column, and the two prefetchers divide the column by
    // date (its rule (b)). But each computes that date from its own
    // `new Date()` and its own zone, so a scheduler pass that straddles
    // local midnight — or a client whose stored `users.timezone` is not the
    // device's — leaves a `{ session, setLogs }` payload on the very date
    // the Today card is reading.
    const db = await getLocalDb();
    await writeHistorySessions(
      db,
      [
        buildHistorySession({
          id: 'session-1',
          clientLocalId: 'local-1',
          scheduledDate: TODAY,
          setLogs: [],
        }),
      ],
      { upcomingOwnsFrom: '2026-08-16' },
    );

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).not.toBe('loading'));

    // Never the error card, and never "rest day" either: there IS a session
    // today, and the one thing this screen owes the client is the ability to
    // open it. The prescription is missing, so the card omits it rather than
    // inventing one — the next revalidation rewrites the row.
    const state = expectSession(result.current.state);
    expect(state.session.localId).toBe('local-1');
    expect(state.session.name).toBe('Push A');
    expect(state.session.exerciseCount).toBe(0);
    expect(state.session.targetSets).toBe(0);
    expect(state.session.estimatedMinutes).toBeNull();
    expect(state.session.previewExerciseNames).toEqual([]);
    expect(state.session.remainingExerciseCount).toBe(0);

    unmount();
  });

  it('closes the loop the other way: a revalidation writes the same cache the read uses', async () => {
    // Nothing has ever been prefetched onto this device, so the only thing
    // that happens is the hook's own background `workouts.upcoming`. It has
    // to land in `local_workout_sessions` and `meta.upcoming_context` in the
    // shape the local read expects, or the card never leaves its fallback.
    mockUpcomingData = upcomingResponse();
    mockUpcomingUpdatedAt = 1;
    mockUpcomingPending = false;

    const { result, unmount } = renderToday();
    await waitFor(() => expect(result.current.state.kind).toBe('session'));

    expect(expectSession(result.current.state).session.localId).toBe('local-1');
    expect(result.current.header).toMatchObject({
      programName: 'Hypertrophy Block 2',
      weekNumber: 6,
    });

    const db = await getLocalDb();
    expect(db.all<Record<string, unknown>>(sql`SELECT * FROM local_workout_sessions`)).toHaveLength(
      1,
    );
    const metaRows = db.all<Record<string, unknown>>(sql`SELECT * FROM meta`);
    expect(metaRows.filter((row) => row.key === 'upcoming_context')).toHaveLength(1);

    unmount();
  });
});
