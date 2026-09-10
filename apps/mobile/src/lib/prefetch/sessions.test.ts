import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { buildBlock, buildContext, buildExercise, buildSession } from './__fixtures__/upcoming.ts';
import {
  parseSessionPayload,
  prefetchSessions,
  prefetchSessionsAndExercises,
  readUpcomingContext,
  resetPrefetchStateForTests,
  upcomingDayContext,
  upcomingRange,
} from './sessions.ts';

// `expo-sqlite` has no Jest-side native module — the hand-built fake in
// `lib/outbox/__fixtures__/sqlite-fake.ts` is reused rather than copied,
// for the reason its own header gives.
type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

async function readSessions(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM local_workout_sessions`);
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
  resetPrefetchStateForTests();
});

describe('upcomingRange', () => {
  // `CLAUDE.md` §25.5's named pitfall, and this task's own Risks section:
  // 19:00 UTC is already tomorrow in Kolkata and still today in New York.
  // Both answers come from `@coachos/utils`, never from a local `Date`
  // getter or `toISOString().slice(0, 10)`.
  const at = new Date('2026-08-14T19:00:00.000Z');

  it('resolves today and tomorrow in a positive-offset zone', () => {
    expect(upcomingRange(at, 'Asia/Kolkata')).toEqual({ from: '2026-08-15', to: '2026-08-16' });
  });

  it('resolves today and tomorrow in a negative-offset zone', () => {
    expect(upcomingRange(at, 'America/New_York')).toEqual({ from: '2026-08-14', to: '2026-08-15' });
  });

  it('crosses a month boundary without arithmetic of its own', () => {
    expect(upcomingRange(new Date('2026-08-31T12:00:00.000Z'), 'UTC')).toEqual({
      from: '2026-08-31',
      to: '2026-09-01',
    });
  });
});

describe('prefetchSessions', () => {
  const today = buildSession({ id: 'session-today', clientLocalId: 'local-today' });
  const tomorrow = buildSession({
    id: 'session-tomorrow',
    clientLocalId: 'local-tomorrow',
    scheduledDate: '2026-08-16',
    programDayId: 'day-2',
    exercises: [buildBlock({ programExerciseId: 'block-2', exerciseId: 'exercise-2' })],
  });
  const exercises = [buildExercise(), buildExercise({ id: 'exercise-2', name: 'Bench Press' })];

  function fetchBoth() {
    return jest.fn(async () => ({
      sessions: [today, tomorrow],
      exercises,
      context: buildContext(),
    }));
  }

  it("writes today's and tomorrow's sessions with a complete payload", async () => {
    const fetchUpcoming = fetchBoth();

    const result = await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming,
    });

    expect(fetchUpcoming).toHaveBeenCalledWith({ from: '2026-08-15', to: '2026-08-16' });
    expect(result).toMatchObject({ inserted: 2, updated: 0, skippedUnsynced: 0 });

    const rows = await readSessions();
    expect(rows).toHaveLength(2);
    const todayRow = rows.find((row) => row.client_local_id === 'local-today');
    expect(todayRow).toMatchObject({
      id: 'session-today',
      server_id: 'session-today',
      scheduled_date: '2026-08-15',
      program_day_id: 'day-1',
      name: 'Push A',
      status: 'scheduled',
      sync_state: 'synced',
    });
  });

  it('denormalises the prescription and its exercises into payload_json', async () => {
    await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: fetchBoth(),
    });

    const rows = await readSessions();
    const todayRow = rows.find((row) => row.client_local_id === 'local-today');
    const payload = parseSessionPayload(String(todayRow?.payload_json));

    // Everything the logger renders, with no join: the day's own label and
    // notes, the block's targets, and the exercise the block names —
    // including its demo URL and cues.
    expect(payload.session.dayName).toBe('Push A');
    expect(payload.session.exercises[0]).toMatchObject({ exerciseId: 'exercise-1', targetSets: 4 });
    expect(payload.exercises.map((exercise) => exercise.id)).toEqual(['exercise-1']);
    expect(payload.exercises[0]?.demoVideoUrl).toBe('https://r2.test/demos/back-squat.mp4');
    expect(payload.exercises[0]?.cues).toEqual(['Brace hard', 'Knees out']);
  });

  it('round-trips Dates through payload_json rather than degrading them to strings', async () => {
    const startedAt = new Date('2026-08-15T05:30:00.000Z');
    await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: jest.fn(async () => ({
        sessions: [buildSession({ status: 'in_progress', startedAt })],
        exercises,
        context: buildContext(),
      })),
    });

    const [row] = await readSessions();
    const payload = parseSessionPayload(String(row?.payload_json));

    expect(payload.session.startedAt).toBeInstanceOf(Date);
    expect(payload.session.startedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(row?.started_at).toBe(startedAt.getTime());
  });

  it('updates rather than duplicating when prefetch runs again', async () => {
    const options = {
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: fetchBoth(),
    };
    await prefetchSessions(options);

    const second = await prefetchSessions({
      ...options,
      fetchUpcoming: jest.fn(async () => ({
        sessions: [
          buildSession({ id: 'session-today', clientLocalId: 'local-today', name: 'Renamed' }),
        ],
        exercises,
        context: buildContext(),
      })),
    });

    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    const rows = await readSessions();
    expect(rows.filter((row) => row.client_local_id === 'local-today')).toHaveLength(1);
    expect(rows.find((row) => row.client_local_id === 'local-today')?.name).toBe('Renamed');
  });

  it('never overwrites a row the device has unsynced changes to', async () => {
    const db = await getLocalDb();
    // A session the client started offline: `offline-sync` §5 gives the
    // device the win here, so a refresh must leave it alone.
    db.run(
      sql`INSERT INTO local_workout_sessions (id, client_local_id, scheduled_date, program_day_id, name, status, payload_json, sync_state, updated_at)
          VALUES (${'session-today'}, ${'local-today'}, ${'2026-08-15'}, ${'day-1'}, ${'Push A'}, ${'in_progress'}, ${'{"json":{}}'}, ${'pending'}, ${1})`,
    );

    const result = await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: fetchBoth(),
    });

    expect(result).toMatchObject({ inserted: 1, updated: 0, skippedUnsynced: 1 });
    const rows = await readSessions();
    expect(rows.find((row) => row.client_local_id === 'local-today')).toMatchObject({
      status: 'in_progress',
      sync_state: 'pending',
      payload_json: '{"json":{}}',
    });
  });

  // `phase-09-workout-logger/today-card/01`. A rest day materialises no
  // session row at all, so the context object is the ONLY thing that tells
  // the device "rest day" from "no program" — which makes persisting it,
  // and persisting it even when the range produced nothing, load-bearing.
  it("caches workouts.upcoming's context object alongside the sessions", async () => {
    await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: fetchBoth(),
    });

    const context = await readUpcomingContext(await getLocalDb());

    expect(context).toMatchObject({
      hasActiveAssignment: true,
      programName: 'Hypertrophy Block 2',
      totalWeeks: 12,
    });
    expect(upcomingDayContext(context, '2026-08-15')).toMatchObject({ weekNumber: 6 });
  });

  it('caches the context for a rest day, where there is no session row to hang it on', async () => {
    await prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: jest.fn(async () => ({
        sessions: [],
        exercises: [],
        context: buildContext({
          days: [
            { date: '2026-08-15', isRestDay: true, weekNumber: 6, dayName: 'Rest' },
            { date: '2026-08-16', isRestDay: false, weekNumber: 6, dayName: 'Pull A' },
          ],
        }),
      })),
    });

    expect(await readSessions()).toHaveLength(0);
    const context = await readUpcomingContext(await getLocalDb());
    expect(upcomingDayContext(context, '2026-08-15')?.isRestDay).toBe(true);
    expect(upcomingDayContext(context, '2026-08-16')?.isRestDay).toBe(false);
  });

  it('overwrites the cached context rather than accumulating rows', async () => {
    const options = { now: new Date('2026-08-15T06:00:00.000Z'), timeZone: 'UTC' };
    await prefetchSessions({ ...options, fetchUpcoming: fetchBoth() });
    await prefetchSessions({
      ...options,
      fetchUpcoming: jest.fn(async () => ({
        sessions: [],
        exercises: [],
        context: buildContext({ hasActiveAssignment: false, programName: null, totalWeeks: null }),
      })),
    });

    const db = await getLocalDb();
    const metaRows = db.all<Row>(sql`SELECT * FROM meta`);
    expect(metaRows.filter((row) => row.key === 'upcoming_context')).toHaveLength(1);
    expect(await readUpcomingContext(db)).toMatchObject({ hasActiveAssignment: false });
  });

  it('returns to the caller while the fetch is still in flight', async () => {
    // The acceptance criterion "prefetch does not block the calling UI
    // thread", as something observable: the caller keeps running, and the
    // local writes happen after the awaited fetch settles.
    const order: string[] = [];
    const fetchUpcoming = jest.fn(
      () =>
        new Promise<{
          sessions: (typeof today)[];
          exercises: typeof exercises;
          context: ReturnType<typeof buildContext>;
        }>((resolve) => {
          setTimeout(() => {
            order.push('fetch-settled');
            resolve({ sessions: [today], exercises, context: buildContext() });
          }, 10);
        }),
    );

    const pending = prefetchSessions({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming,
    });
    order.push('caller-continued');
    expect(await readSessions()).toHaveLength(0);

    await pending;
    order.push('prefetch-done');

    expect(order).toEqual(['caller-continued', 'fetch-settled', 'prefetch-done']);
    expect(await readSessions()).toHaveLength(1);
  });
});

describe('prefetchSessionsAndExercises', () => {
  it('writes both the sessions and the exercises they reference', async () => {
    const result = await prefetchSessionsAndExercises({
      now: new Date('2026-08-15T06:00:00.000Z'),
      timeZone: 'UTC',
      fetchUpcoming: jest.fn(async () => ({
        sessions: [buildSession()],
        exercises: [buildExercise()],
        context: buildContext(),
      })),
    });

    expect(result).toMatchObject({ inserted: 1, exercisesInserted: 1, exercisesUpdated: 0 });
    const db = await getLocalDb();
    const cached = db.all<Row>(sql`SELECT * FROM local_exercises_cache`);
    expect(cached.map((row) => row.id)).toEqual(['exercise-1']);
  });
});
