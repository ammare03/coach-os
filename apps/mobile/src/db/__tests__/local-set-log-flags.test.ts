import { getLocalDb, resetLocalDbForTests } from '../client.ts';
import { LOCAL_TRAINING_SCHEMA_SQL, localSetLogs, localWorkoutSessions } from '../schema/index.ts';

// `phase-09-workout-logger/set-entry/04`. `is_warmup` round-tripped from the
// first version of the logger; `is_failure` reached the server on the wire
// and stopped there, because this mirror had no column for it. A client who
// logged a set to failure and force-quit reloaded the session from here and
// saw the flag gone. These tests pin the column, its default, and its
// independence from its sibling — `schema-ddl-drift.test.ts` separately
// pins that the bootstrap DDL and the Drizzle definition still agree.
//
// Uses the shared `sqlite-fake` rather than this folder's narrower one:
// `useLogSet` writes through Drizzle's insert builder, and only that fake
// serves the builder's `executeForRawResultSync` path.
jest.mock('expo-sqlite', () =>
  require('../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
});

const SESSION_LOCAL_ID = '018f4b1e-0000-7000-8000-0000000000aa';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';
const LOGGED_AT_MS = 1_757_000_000_500;

async function seedSession() {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SESSION_LOCAL_ID,
    clientLocalId: SESSION_LOCAL_ID,
    scheduledDate: '2026-09-08',
    status: 'in_progress',
    payloadJson: '{}',
    syncState: 'pending',
    updatedAt: LOGGED_AT_MS,
  });
  return db;
}

type SetLogInsert = typeof localSetLogs.$inferInsert;

function setRow(overrides: Partial<SetLogInsert> & Pick<SetLogInsert, 'id'>): SetLogInsert {
  return {
    clientLocalId: overrides.id,
    sessionLocalId: SESSION_LOCAL_ID,
    exerciseId: EXERCISE_ID,
    setNumber: 1,
    reps: 5,
    weightKg: 62.5,
    loggedAt: LOGGED_AT_MS,
    syncState: 'pending',
    ...overrides,
  };
}

describe('local_set_logs.is_failure', () => {
  it('survives a write-then-read through the mirror', async () => {
    const db = await seedSession();

    await db.insert(localSetLogs).values(setRow({ id: 'set-failed', reps: 0, isFailure: true }));
    const [read] = await db.select().from(localSetLogs);

    expect(read?.isFailure).toBe(true);
  });

  it('defaults to false when the caller omits it, exactly like is_warmup', async () => {
    const db = await seedSession();

    await db.insert(localSetLogs).values(setRow({ id: 'set-plain' }));
    const [read] = await db.select().from(localSetLogs);

    expect(read?.isFailure).toBe(false);
    expect(read?.isWarmup).toBe(false);
  });

  it('is independent of is_warmup — neither flag reads the other back', async () => {
    const db = await seedSession();

    await db
      .insert(localSetLogs)
      .values(setRow({ id: 'set-warmup', isWarmup: true, isFailure: false }));
    await db
      .insert(localSetLogs)
      .values(setRow({ id: 'set-failure', setNumber: 2, isWarmup: false, isFailure: true }));

    const rows = await db.select().from(localSetLogs);
    const warmup = rows.find((row) => row.id === 'set-warmup');
    const failure = rows.find((row) => row.id === 'set-failure');

    expect(warmup).toMatchObject({ isWarmup: true, isFailure: false });
    expect(failure).toMatchObject({ isWarmup: false, isFailure: true });
  });

  it('declares the same nullability and default as is_warmup in the bootstrap DDL', () => {
    const createSetLogs = LOCAL_TRAINING_SCHEMA_SQL.find((statement) =>
      statement.includes('CREATE TABLE IF NOT EXISTS local_set_logs'),
    );
    if (!createSetLogs) throw new Error('local_set_logs CREATE TABLE statement not found');

    // The drift test checks name, type, and NOT NULL against the Drizzle
    // definition; it does not read DEFAULT. A `is_failure` defaulting to 1
    // would mark every existing set as taken to failure.
    expect(createSetLogs).toContain('is_warmup INTEGER NOT NULL DEFAULT 0');
    expect(createSetLogs).toContain('is_failure INTEGER NOT NULL DEFAULT 0');
  });
});
