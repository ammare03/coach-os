import { eq } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import {
  localExercisesCache,
  localSetLogs,
  localWorkoutSessions,
} from '../../../../db/schema/local-training.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { LocalSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import type { SessionRecord } from '../../store/session-records-store.ts';
import {
  SUMMARY_COPY,
  buildRecordLines,
  describeFinishedAt,
  formatSessionDuration,
  formatSessionVolume,
  formatSetsLogged,
  readSessionSummary,
} from '../session-summary.ts';

// `phase-09-workout-logger/session-summary/01`. Every figure on this screen
// comes from the device, so this is where "renders instantly, offline" is
// actually decided — one pass over two local tables and nothing else.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const SESSION = '0198f2d6-0000-7000-8000-0000000000aa';
const SQUAT = '0198f2d6-0000-7000-8000-0000000000d1';
const RDL = '0198f2d6-0000-7000-8000-0000000000d2';

const STARTED_AT = Date.parse('2026-08-15T18:00:00.000Z');
const COMPLETED_AT = Date.parse('2026-08-15T18:48:30.000Z');

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
});

function payload(): LocalSessionPayload {
  return {
    session: {
      name: 'Lower body A',
      exercises: [
        { id: 'b-1', exerciseId: SQUAT, targetSets: 3, targetRestSeconds: 90 },
        { id: 'b-2', exerciseId: RDL, targetSets: 3, targetRestSeconds: 90 },
      ],
    },
    exercises: [
      { id: SQUAT, name: 'Barbell back squat' },
      { id: RDL, name: 'Romanian deadlift' },
    ],
  } as unknown as LocalSessionPayload;
}

/** An ad-hoc session: a real payload with nothing prescribed and no library. */
function adHocPayload(): LocalSessionPayload {
  return {
    session: { name: null, exercises: [] },
    exercises: [],
  } as unknown as LocalSessionPayload;
}

async function seed(
  options: {
    status?: string;
    startedAt?: number | null;
    completedAt?: number | null;
    withPayload?: boolean;
  } = {},
) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SESSION,
    clientLocalId: SESSION,
    serverId: null,
    scheduledDate: '2026-08-15',
    programDayId: null,
    name: 'Lower body A',
    status: options.status ?? 'completed',
    startedAt: options.startedAt === undefined ? STARTED_AT : options.startedAt,
    completedAt: options.completedAt === undefined ? COMPLETED_AT : options.completedAt,
    payloadJson: serialiseSessionPayload(
      options.withPayload === false ? adHocPayload() : payload(),
    ),
    startOutboxId: null,
    syncState: 'pending',
    updatedAt: COMPLETED_AT,
  });
  await db.insert(localExercisesCache).values([
    { id: SQUAT, name: 'Barbell back squat' },
    { id: RDL, name: 'Romanian deadlift' },
  ]);
  return db;
}

async function logSet(
  db: Awaited<ReturnType<typeof getLocalDb>>,
  set: {
    id: string;
    exerciseId: string;
    reps: number | null;
    weightKg: number | null;
    isWarmup?: boolean;
  },
) {
  await db.insert(localSetLogs).values({
    id: set.id,
    clientLocalId: set.id,
    sessionLocalId: SESSION,
    exerciseId: set.exerciseId,
    setNumber: 1,
    reps: set.reps,
    weightKg: set.weightKg,
    rpe: null,
    isWarmup: set.isWarmup ?? false,
    isFailure: false,
    notes: null,
    loggedAt: STARTED_AT,
    syncState: 'pending',
  });
}

describe('readSessionSummary', () => {
  it('reads volume, duration and counts from local state alone', async () => {
    const db = await seed();
    await logSet(db, { id: 's1', exerciseId: SQUAT, reps: 5, weightKg: 100 });
    await logSet(db, { id: 's2', exerciseId: SQUAT, reps: 5, weightKg: 102.5 });
    await logSet(db, { id: 's3', exerciseId: RDL, reps: 10, weightKg: 80 });
    // Warm-ups are ramp-up work, not the session's volume or its set count.
    await logSet(db, { id: 's4', exerciseId: SQUAT, reps: 8, weightKg: 40, isWarmup: true });

    const summary = await readSessionSummary(SESSION, db);

    expect(summary).not.toBeNull();
    expect(summary?.name).toBe('Lower body A');
    expect(summary?.volumeKg).toBe(5 * 100 + 5 * 102.5 + 10 * 80);
    expect(summary?.durationSeconds).toBe(2910);
    expect(summary?.setsLogged).toBe(3);
    expect(summary?.targetSets).toBe(6);
    expect(summary?.exerciseNames.get(SQUAT)).toBe('Barbell back squat');
  });

  it('returns null volume rather than zero when nothing carried a weight', async () => {
    // A bodyweight session did not lift nothing (`COPY.md` CO§2) — the cell
    // is dropped, never printed as 0.
    const db = await seed();
    await logSet(db, { id: 's1', exerciseId: SQUAT, reps: 12, weightKg: null });

    expect((await readSessionSummary(SESSION, db))?.volumeKg).toBeNull();
  });

  it('returns null duration for a session with no start instant', async () => {
    const db = await seed({ startedAt: null });

    expect((await readSessionSummary(SESSION, db))?.durationSeconds).toBeNull();
  });

  it('returns null for a session this device does not hold', async () => {
    const db = await getLocalDb();

    expect(await readSessionSummary(SESSION, db)).toBeNull();
  });

  it('still names exercises for a session with no prescription at all', async () => {
    // An ad-hoc session: nothing programmed, and no library in the payload.
    // The exercise cache is the fallback, and it is read in the same pass.
    const db = await seed({ withPayload: false });
    await logSet(db, { id: 's1', exerciseId: SQUAT, reps: 5, weightKg: 100 });

    const summary = await readSessionSummary(SESSION, db);
    expect(summary?.targetSets).toBe(0);
    expect(summary?.exerciseNames.get(SQUAT)).toBe('Barbell back squat');
  });

  it('does not count a set that belongs to a different session', async () => {
    const db = await seed();
    await db.insert(localWorkoutSessions).values({
      id: 'other',
      clientLocalId: 'other',
      serverId: null,
      scheduledDate: '2026-08-15',
      programDayId: null,
      name: null,
      status: 'completed',
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      payloadJson: serialiseSessionPayload(payload()),
      startOutboxId: null,
      syncState: 'pending',
      updatedAt: COMPLETED_AT,
    });
    await db.insert(localSetLogs).values({
      id: 'x1',
      clientLocalId: 'x1',
      sessionLocalId: 'other',
      exerciseId: SQUAT,
      setNumber: 1,
      reps: 5,
      weightKg: 999,
      rpe: null,
      isWarmup: false,
      isFailure: false,
      notes: null,
      loggedAt: STARTED_AT,
      syncState: 'pending',
    });

    expect((await readSessionSummary(SESSION, db))?.setsLogged).toBe(0);
  });

  it('leaves the row exactly as it found it', async () => {
    const db = await seed();
    await readSessionSummary(SESSION, db);

    const [row] = await db
      .select()
      .from(localWorkoutSessions)
      .where(eq(localWorkoutSessions.clientLocalId, SESSION));
    expect(row?.syncState).toBe('pending');
    expect(row?.updatedAt).toBe(COMPLETED_AT);
  });
});

describe('formatters', () => {
  it('states a volume without a trailing tenth it never had', () => {
    expect(formatSessionVolume(4280, 'kg')).toEqual({
      value: '4280',
      unit: 'kg',
      label: 'Volume, 4280 kilograms',
    });
  });

  it('converts a volume for display only', () => {
    expect(formatSessionVolume(100, 'lb')).toEqual({
      value: '220',
      unit: 'lb',
      label: 'Volume, 220 pounds',
    });
  });

  it('states a duration in whole minutes', () => {
    expect(formatSessionDuration(2910)).toEqual({
      value: '49',
      unit: 'min',
      label: 'Time, 49 minutes',
    });
    expect(formatSessionDuration(60)).toEqual({
      value: '1',
      unit: 'min',
      label: 'Time, 1 minute',
    });
  });

  it('states sets against the plan when there is one, and alone when there is not', () => {
    expect(formatSetsLogged(22, 24)).toEqual({
      value: '22',
      unit: 'of 24',
      label: 'Sets, 22 of 24',
    });
    expect(formatSetsLogged(9, 0)).toEqual({ value: '9', label: 'Sets, 9' });
  });

  it('says when the session finished, in the client zone', () => {
    expect(describeFinishedAt(new Date(COMPLETED_AT), 'Asia/Kolkata')).toBe(
      'Sunday · finished 00:18',
    );
  });
});

describe('buildRecordLines', () => {
  function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
    return {
      setLocalId: 'set-1',
      exerciseId: SQUAT,
      reps: 5,
      weightKg: 102.5,
      estimated1rmKg: 119.6,
      types: ['max_weight'],
      atMs: 1_000,
      ...overrides,
    };
  }

  const names = new Map([
    [SQUAT, 'Barbell back squat'],
    [RDL, 'Romanian deadlift'],
  ]);

  it('lists every record, worded exactly as the pill words it', () => {
    const lines = buildRecordLines(
      [
        record(),
        record({
          setLocalId: 'set-2',
          exerciseId: RDL,
          reps: 12,
          weightKg: 80,
          types: ['max_reps'],
          atMs: 2_000,
        }),
      ],
      names,
      'kg',
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]?.lead).toBe('Barbell back squat — heaviest ever,');
    expect(lines[0]?.value).toBe('102.5kg');
    expect(lines[1]?.lead).toBe('Romanian deadlift — most reps at 80kg,');
    expect(lines[1]?.value).toBe('12');
  });

  it('collapses the other types beaten into a count, never a second row', () => {
    const lines = buildRecordLines(
      [record({ types: ['max_weight', '1rm_estimated', 'max_volume'] })],
      names,
      'kg',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]?.moreCount).toBe(2);
  });

  it('drops a record it cannot name an exercise for', () => {
    expect(buildRecordLines([record({ exerciseId: 'unknown' })], names, 'kg')).toEqual([]);
  });

  it('drops a record it cannot word', () => {
    // A bodyweight set whose only type has no value to print.
    expect(
      buildRecordLines([record({ weightKg: null, types: ['max_weight'] })], names, 'kg'),
    ).toEqual([]);
  });
});

describe('SUMMARY_COPY', () => {
  it('counts modifications without judging them', () => {
    expect(SUMMARY_COPY.skipped(1)).toBe('1 exercise skipped');
    expect(SUMMARY_COPY.skipped(3)).toBe('3 exercises skipped');
    expect(SUMMARY_COPY.swapped(1)).toBe('1 exercise swapped');
    expect(SUMMARY_COPY.swapped(2)).toBe('2 exercises swapped');
  });
});
