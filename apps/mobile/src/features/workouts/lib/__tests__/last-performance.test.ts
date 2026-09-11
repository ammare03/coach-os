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
  pickPreviousSession,
  readLastPerformance,
  readPreviousSession,
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
    sessionKey: 'session-1',
    setNumber: 1,
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

// `set-entry/03`. The exercise-level line answers "what did I do last
// time"; these answer "what did I do on THIS set number last time", and the
// distance between the two is entirely in how a mismatch is handled.
describe('pickPreviousSession', () => {
  const session = 'session-last';

  function setOf(
    setNumber: number,
    weightKg: number,
    reps: number,
    minute: number,
  ): LastPerformanceCandidate {
    return candidate({
      sessionKey: session,
      setNumber,
      weightKg,
      reps,
      loggedAt: new Date(`2026-08-08T18:${String(minute).padStart(2, '0')}:00.000Z`),
    });
  }

  it('keys every set of the previous session by its own set number', () => {
    const previous = pickPreviousSession(
      [setOf(1, 60, 10, 0), setOf(2, 62.5, 9, 5), setOf(3, 65, 7, 10)],
      'exercise-1',
    );

    expect(previous?.bySetNumber.get(1)).toMatchObject({ setNumber: 1, weightKg: 60, reps: 10 });
    expect(previous?.bySetNumber.get(2)).toMatchObject({ setNumber: 2, weightKg: 62.5, reps: 9 });
    expect(previous?.bySetNumber.get(3)).toMatchObject({ setNumber: 3, weightKg: 65, reps: 7 });
  });

  // The acceptance criterion: the previous session had 2 sets, this one has
  // 4. Sets 3 and 4 are absent, which the row renders as nothing — never an
  // error, and never set 2's number wearing set 3's name.
  it('has no entry for a set number the previous session never reached', () => {
    const previous = pickPreviousSession([setOf(1, 60, 10, 0), setOf(2, 62.5, 9, 5)], 'exercise-1');

    expect(previous).not.toBeNull();
    expect(previous?.bySetNumber.get(3)).toBeUndefined();
    expect(previous?.bySetNumber.get(4)).toBeUndefined();
  });

  // And the mirror: 4 sets last time, 3 today. Nothing is dropped or
  // renumbered; the extra entry is simply never asked for.
  it('keeps the previous session extra sets rather than truncating to this one', () => {
    const previous = pickPreviousSession(
      [setOf(1, 60, 10, 0), setOf(2, 60, 9, 5), setOf(3, 60, 8, 10), setOf(4, 60, 6, 15)],
      'exercise-1',
    );

    expect(previous?.bySetNumber.size).toBe(4);
    expect(previous?.bySetNumber.get(4)).toMatchObject({ weightKg: 60, reps: 6 });
  });

  // The risk `set-entry/03` names by name. Set 2 was deleted, so the
  // previous session holds sets 1 and 3. Under positional matching set 3
  // would read 70kg × 5 off array index 1 — set 3's row showing a number
  // the client never lifted on set 3.
  it('aligns across a gap in set numbers where an array index would not', () => {
    const previous = pickPreviousSession([setOf(1, 60, 10, 0), setOf(3, 70, 5, 10)], 'exercise-1');

    expect(previous?.bySetNumber.get(2)).toBeUndefined();
    expect(previous?.bySetNumber.get(3)).toMatchObject({ setNumber: 3, weightKg: 70, reps: 5 });
  });

  it('is unmoved by the order the sets arrive in', () => {
    const previous = pickPreviousSession(
      [setOf(3, 65, 7, 10), setOf(1, 60, 10, 0), setOf(2, 62.5, 9, 5)],
      'exercise-1',
    );

    expect(previous?.bySetNumber.get(1)).toMatchObject({ weightKg: 60 });
    expect(previous?.bySetNumber.get(3)).toMatchObject({ weightKg: 65 });
  });

  // DB§22 again, applied per set: a warm-up is not a previous performance,
  // and its set number is therefore absent rather than occupied.
  it('leaves a warm-up set number empty instead of reporting the warm-up', () => {
    const warmup = candidate({
      sessionKey: session,
      setNumber: 1,
      weightKg: 20,
      reps: 10,
      isWarmup: true,
      loggedAt: new Date('2026-08-08T17:50:00.000Z'),
    });
    const previous = pickPreviousSession([warmup, setOf(2, 100, 5, 5)], 'exercise-1');

    expect(previous?.bySetNumber.get(1)).toBeUndefined();
    expect(previous?.bySetNumber.get(2)).toMatchObject({ weightKg: 100 });
  });

  // "Last time" is one workout. Assembling set 1 from this week and set 3
  // from a fortnight ago would describe a session the client never trained.
  it('takes every set from the one most recent session, never across sessions', () => {
    const older = candidate({
      sessionKey: 'session-older',
      setNumber: 3,
      weightKg: 999,
      reps: 1,
      loggedAt: new Date('2026-08-01T18:00:00.000Z'),
    });
    const previous = pickPreviousSession([older, setOf(1, 60, 10, 0)], 'exercise-1');

    expect(previous?.bySetNumber.size).toBe(1);
    expect(previous?.bySetNumber.get(3)).toBeUndefined();
  });

  // The same set can surface twice — the device's own row and the synced
  // copy that came back through history. One slot, and on an identical
  // `logged_at` the device's value stands (`offline-sync` §5).
  it('collapses one set reaching it from both sources into one entry', () => {
    const at = new Date('2026-08-08T18:00:00.000Z');
    const device = candidate({ sessionKey: session, setNumber: 1, weightKg: 62.5, loggedAt: at });
    const synced = candidate({ sessionKey: session, setNumber: 1, weightKg: 60, loggedAt: at });

    const previous = pickPreviousSession([device, synced], 'exercise-1');

    expect(previous?.bySetNumber.size).toBe(1);
    expect(previous?.bySetNumber.get(1)).toMatchObject({ weightKg: 62.5 });
  });

  it('is null when the client has never logged this exercise', () => {
    expect(pickPreviousSession([], 'exercise-1')).toBeNull();
  });

  // The two grains must never disagree about which day they describe.
  it('reports the same set as pickLastPerformance', () => {
    const candidates = [setOf(1, 60, 10, 0), setOf(2, 62.5, 9, 5)];

    expect(pickPreviousSession(candidates, 'exercise-1')?.last).toEqual(
      pickLastPerformance(candidates, 'exercise-1'),
    );
  });
});

describe('readPreviousSession', () => {
  let counter = 0;
  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}-prev-${String(counter)}`;
  }

  interface SeedSet {
    setNumber: number;
    weightKg: number;
    reps: number;
    loggedAt: string;
    isWarmup?: boolean;
  }

  async function seedSession(options: {
    key: string;
    scheduledDate: string;
    exerciseId: string;
    sets: SeedSet[];
  }): Promise<void> {
    const db = await getLocalDb();
    const setLogs = options.sets.map((set) =>
      buildSetLog({
        id: nextId('set'),
        clientLocalId: nextId('set-local'),
        exerciseId: options.exerciseId,
        setNumber: set.setNumber,
        weightKg: set.weightKg,
        reps: set.reps,
        isWarmup: set.isWarmup ?? false,
        loggedAt: new Date(set.loggedAt),
      }),
    );
    const session = buildHistorySession({
      id: options.key,
      clientLocalId: options.key,
      scheduledDate: options.scheduledDate,
      setLogs,
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

  it('reads the previous session set by set, across a deleted set number', async () => {
    const exerciseId = nextId('exercise');
    await seedSession({
      key: nextId('hist'),
      scheduledDate: '2026-08-08',
      exerciseId,
      sets: [
        {
          setNumber: 1,
          weightKg: 20,
          reps: 10,
          loggedAt: '2026-08-08T17:50:00.000Z',
          isWarmup: true,
        },
        { setNumber: 2, weightKg: 80, reps: 8, loggedAt: '2026-08-08T18:00:00.000Z' },
        { setNumber: 4, weightKg: 85, reps: 6, loggedAt: '2026-08-08T18:10:00.000Z' },
      ],
    });

    const previous = await readPreviousSession(await getLocalDb(), {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(previous?.bySetNumber.get(1)).toBeUndefined();
    expect(previous?.bySetNumber.get(2)).toMatchObject({ weightKg: 80, reps: 8 });
    expect(previous?.bySetNumber.get(3)).toBeUndefined();
    expect(previous?.bySetNumber.get(4)).toMatchObject({ weightKg: 85, reps: 6 });
    expect(previous?.last).toMatchObject({ weightKg: 85, reps: 6 });
  });

  it('ignores an older session once a newer one exists', async () => {
    const exerciseId = nextId('exercise');
    await seedSession({
      key: nextId('hist'),
      scheduledDate: '2026-08-01',
      exerciseId,
      sets: [
        { setNumber: 1, weightKg: 70, reps: 8, loggedAt: '2026-08-01T18:00:00.000Z' },
        { setNumber: 2, weightKg: 70, reps: 7, loggedAt: '2026-08-01T18:05:00.000Z' },
        { setNumber: 3, weightKg: 70, reps: 6, loggedAt: '2026-08-01T18:10:00.000Z' },
      ],
    });
    await seedSession({
      key: nextId('hist'),
      scheduledDate: '2026-08-08',
      exerciseId,
      sets: [{ setNumber: 1, weightKg: 75, reps: 8, loggedAt: '2026-08-08T18:00:00.000Z' }],
    });

    const previous = await readPreviousSession(await getLocalDb(), {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(previous?.bySetNumber.size).toBe(1);
    expect(previous?.bySetNumber.get(1)).toMatchObject({ weightKg: 75 });
    expect(previous?.bySetNumber.get(3)).toBeUndefined();
  });

  it('is null for an exercise this client has never logged', async () => {
    await expect(
      readPreviousSession(await getLocalDb(), {
        exerciseId: nextId('never-logged'),
        excludeSessionLocalId: nextId('current'),
      }),
    ).resolves.toBeNull();
  });

  // Source (b), per set: an offline session's own rows carry their set
  // numbers straight off `local_set_logs`.
  it('keys an unsynced local session by set number too', async () => {
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

    for (const set of [
      { setNumber: 1, weightKg: 72.5, reps: 7, at: '2026-08-14T18:00:00.000Z' },
      { setNumber: 2, weightKg: 72.5, reps: 6, at: '2026-08-14T18:05:00.000Z' },
    ]) {
      await db.insert(localSetLogs).values({
        id: nextId('local-set'),
        clientLocalId: nextId('local-set-key'),
        sessionLocalId: other,
        exerciseId,
        setNumber: set.setNumber,
        reps: set.reps,
        weightKg: set.weightKg,
        rpe: null,
        isWarmup: false,
        notes: null,
        loggedAt: new Date(set.at).getTime(),
        syncState: 'pending',
      });
    }

    const previous = await readPreviousSession(db, {
      exerciseId,
      excludeSessionLocalId: nextId('current'),
    });

    expect(previous?.bySetNumber.get(1)).toMatchObject({ weightKg: 72.5, reps: 7 });
    expect(previous?.bySetNumber.get(2)).toMatchObject({ weightKg: 72.5, reps: 6 });
  });
});
