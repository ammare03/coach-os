import { getLocalDb } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { buildHistorySession, buildSetLog } from '../../../../lib/prefetch/__fixtures__/history.ts';
import {
  buildBlock,
  buildExercise,
  buildSession,
} from '../../../../lib/prefetch/__fixtures__/upcoming.ts';
import { serialiseHistoryPayload } from '../../../../lib/prefetch/history.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import {
  pickLastPerformance,
  readLastPerformance,
  type LastPerformanceCandidate,
} from '../last-performance.ts';

// `expo-sqlite` has no Jest-side native module, so this runs against the
// same fake `lib/outbox` maintains — the same mock and the same reason as
// `__tests__/logger-position.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

function candidate(overrides: Partial<LastPerformanceCandidate> = {}): LastPerformanceCandidate {
  return {
    exerciseId: 'exercise-1',
    weightKg: 60,
    reps: 9,
    isWarmup: false,
    loggedAt: new Date('2026-08-10T18:00:00.000Z'),
    ...overrides,
  };
}

describe('pickLastPerformance', () => {
  it('returns the most recent working set of the exercise asked for', () => {
    const last = pickLastPerformance(
      [
        candidate({ weightKg: 55, reps: 10, loggedAt: new Date('2026-08-01T18:00:00.000Z') }),
        candidate({ weightKg: 60, reps: 9, loggedAt: new Date('2026-08-08T18:00:00.000Z') }),
        candidate({ weightKg: 57.5, reps: 9, loggedAt: new Date('2026-08-04T18:00:00.000Z') }),
      ],
      'exercise-1',
    );

    expect(last).toEqual({
      weightKg: 60,
      reps: 9,
      loggedAt: new Date('2026-08-08T18:00:00.000Z'),
    });
  });

  it('ignores other exercises', () => {
    const last = pickLastPerformance(
      [
        candidate({
          exerciseId: 'exercise-2',
          weightKg: 200,
          loggedAt: new Date('2026-08-09T00:00:00.000Z'),
        }),
        candidate({ weightKg: 60 }),
      ],
      'exercise-1',
    );

    expect(last?.weightKg).toBe(60);
  });

  // DB§22 filters warm-ups out of this query, and the reason is a client
  // reading "last time: 20kg × 10" for a lift they then worked at 100kg.
  it('never answers with a warm-up, even when it is the newest set', () => {
    const last = pickLastPerformance(
      [
        candidate({
          weightKg: 20,
          reps: 10,
          isWarmup: true,
          loggedAt: new Date('2026-08-12T00:00:00.000Z'),
        }),
        candidate({ weightKg: 100, reps: 5, loggedAt: new Date('2026-08-11T00:00:00.000Z') }),
      ],
      'exercise-1',
    );

    expect(last?.weightKg).toBe(100);
  });

  // "last time: ×" is not a sentence. A timed carry or a distance row is a
  // real set with neither a load nor a rep count in it.
  it('skips a set carrying neither a weight nor a rep count', () => {
    expect(
      pickLastPerformance([candidate({ weightKg: null, reps: null })], 'exercise-1'),
    ).toBeNull();
  });

  it('keeps a bodyweight set, which has reps and no weight', () => {
    const last = pickLastPerformance([candidate({ weightKg: null, reps: 12 })], 'exercise-1');
    expect(last).toMatchObject({ weightKg: null, reps: 12 });
  });

  it('is null when the client has never logged this exercise', () => {
    expect(pickLastPerformance([], 'exercise-1')).toBeNull();
  });
});

describe('readLastPerformance', () => {
  let counter = 0;
  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}-${String(counter)}`;
  }

  async function seedHistory(options: {
    key: string;
    scheduledDate: string;
    exerciseId: string;
    weightKg: number | null;
    reps: number | null;
    loggedAt: string;
    isWarmup?: boolean;
  }): Promise<void> {
    const db = await getLocalDb();
    const setLog = buildSetLog({
      id: nextId('set'),
      clientLocalId: nextId('set-local'),
      exerciseId: options.exerciseId,
      weightKg: options.weightKg,
      reps: options.reps,
      isWarmup: options.isWarmup ?? false,
      loggedAt: new Date(options.loggedAt),
    });
    const session = buildHistorySession({
      id: options.key,
      clientLocalId: options.key,
      scheduledDate: options.scheduledDate,
      setLogs: [setLog],
    });

    await db.insert(localWorkoutSessions).values({
      id: options.key,
      clientLocalId: options.key,
      serverId: options.key,
      scheduledDate: options.scheduledDate,
      programDayId: null,
      name: null,
      status: 'completed',
      startedAt: null,
      completedAt: null,
      payloadJson: serialiseHistoryPayload({ session, setLogs: session.setLogs }),
      syncState: 'synced',
      updatedAt: Date.now(),
    });
  }

  it('answers with the newest prescribed-exercise set from the prefetched history', async () => {
    const exerciseId = nextId('exercise');
    await seedHistory({
      key: nextId('hist'),
      scheduledDate: '2026-08-01',
      exerciseId,
      weightKg: 55,
      reps: 10,
      loggedAt: '2026-08-01T18:00:00.000Z',
    });
    await seedHistory({
      key: nextId('hist'),
      scheduledDate: '2026-08-08',
      exerciseId,
      weightKg: 60,
      reps: 9,
      loggedAt: '2026-08-08T18:00:00.000Z',
    });

    const last = await readLastPerformance(await getLocalDb(), {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(last).toMatchObject({ weightKg: 60, reps: 9 });
  });

  // The whole point of the exclusion: a client who has just logged set 1 of
  // this exercise must still see the PREVIOUS session's number, because
  // that is what decides the load they are about to put on the bar.
  it('never reports the session being logged right now as "last time"', async () => {
    const exerciseId = nextId('exercise');
    const current = nextId('current');

    await seedHistory({
      key: nextId('hist'),
      scheduledDate: '2026-08-08',
      exerciseId,
      weightKg: 60,
      reps: 9,
      loggedAt: '2026-08-08T18:00:00.000Z',
    });
    await seedHistory({
      key: current,
      scheduledDate: '2026-08-15',
      exerciseId,
      weightKg: 65,
      reps: 8,
      loggedAt: '2026-08-15T18:00:00.000Z',
    });

    const last = await readLastPerformance(await getLocalDb(), {
      exerciseId,
      excludeSessionLocalId: current,
    });

    expect(last).toMatchObject({ weightKg: 60, reps: 9 });
  });

  // Source (b). A session logged in a basement has not come back through
  // `clientApp.history` yet, and the only record of it is the device's own
  // mirror row.
  it('sees a set this device logged in another session but has not synced', async () => {
    const exerciseId = nextId('exercise');
    const other = nextId('offline-session');
    const db = await getLocalDb();

    await db.insert(localWorkoutSessions).values({
      id: other,
      clientLocalId: other,
      serverId: null,
      scheduledDate: '2026-08-14',
      programDayId: null,
      name: null,
      status: 'completed',
      startedAt: null,
      completedAt: null,
      payloadJson: serialiseSessionPayload({
        session: buildSession({ exercises: [buildBlock()] }),
        exercises: [buildExercise()],
      }),
      syncState: 'pending',
      updatedAt: Date.now(),
    });
    await db.insert(localSetLogs).values({
      id: nextId('local-set'),
      clientLocalId: nextId('local-set-key'),
      sessionLocalId: other,
      exerciseId,
      setNumber: 1,
      reps: 7,
      weightKg: 72.5,
      rpe: 9,
      isWarmup: false,
      notes: null,
      loggedAt: new Date('2026-08-14T18:00:00.000Z').getTime(),
      syncState: 'pending',
    });

    const last = await readLastPerformance(db, {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(last).toMatchObject({ weightKg: 72.5, reps: 7 });
  });

  // A row written by `lib/prefetch/sessions.ts` holds `{ session, exercises }`
  // and no `setLogs` at all — history.ts's rule (b). Reading one as history
  // must produce nothing rather than throwing on the way past it.
  it('walks past an upcoming-prescription payload without mistaking it for history', async () => {
    const exerciseId = nextId('exercise');
    const db = await getLocalDb();
    const upcoming = nextId('upcoming');

    await db.insert(localWorkoutSessions).values({
      id: upcoming,
      clientLocalId: upcoming,
      serverId: null,
      scheduledDate: '2026-09-01',
      programDayId: 'day-1',
      name: null,
      status: 'scheduled',
      startedAt: null,
      completedAt: null,
      payloadJson: serialiseSessionPayload({
        session: buildSession({ exercises: [buildBlock({ exerciseId })] }),
        exercises: [buildExercise({ id: exerciseId })],
      }),
      syncState: 'synced',
      updatedAt: Date.now(),
    });
    await seedHistory({
      key: nextId('hist'),
      scheduledDate: '2026-08-20',
      exerciseId,
      weightKg: 50,
      reps: 12,
      loggedAt: '2026-08-20T18:00:00.000Z',
    });

    const last = await readLastPerformance(db, {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(last).toMatchObject({ weightKg: 50, reps: 12 });
  });

  it('degrades a corrupt payload to nothing rather than taking the logger down mid-set', async () => {
    const exerciseId = nextId('exercise');
    const db = await getLocalDb();
    const broken = nextId('broken');

    await db.insert(localWorkoutSessions).values({
      id: broken,
      clientLocalId: broken,
      serverId: null,
      scheduledDate: '2026-09-09',
      programDayId: null,
      name: null,
      status: 'completed',
      startedAt: null,
      completedAt: null,
      payloadJson: '{ not json at all',
      syncState: 'synced',
      updatedAt: Date.now(),
    });

    await expect(
      readLastPerformance(db, { exerciseId, excludeSessionLocalId: nextId('current') }),
    ).resolves.toBeNull();
  });

  it('is null for an exercise this client has never logged', async () => {
    const last = await readLastPerformance(await getLocalDb(), {
      exerciseId: nextId('never-logged'),
      excludeSessionLocalId: nextId('current'),
    });

    expect(last).toBeNull();
  });
});
