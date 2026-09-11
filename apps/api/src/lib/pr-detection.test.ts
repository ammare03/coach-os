// Real Postgres (`testing` skill §4), driven through `logSet` rather than
// against `detectPersonalRecords` in isolation — the two acceptance criteria
// this file exists for are both about the seam: that detection runs inside
// the set-log's own transaction, and that what it returns is what the device
// receives.
//
// The *rules* — which sets qualify, which one holds a type, when a record is
// withdrawn — are asserted once, in
// `packages/db/src/aggregates/recompute-personal-records.test.ts`. This file
// deliberately re-asserts none of them. What it covers is the one thing
// `pr-detection.ts` actually decides: which types this set newly took.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import { deleteSet } from '../features/workouts/delete-set.ts';
import { logSet, type LogSetInput } from '../features/workouts/log-set.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let coachProfileId: string;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  coachProfileId = await insertCoach();
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

const TAPPED_AT = new Date('2026-08-15T09:14:22.000Z');

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@pr-detection.test`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db.insert(schema.coachProfiles).values({ userId: user.id }).returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return profile.id;
}

interface Fixture {
  clientProfileId: string;
  exerciseId: string;
  sessionClientLocalId: string;
}

/** A fresh client, exercise, and in-progress session — no history at all. */
async function fixture(): Promise<Fixture> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@pr-detection.test`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');

  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
    })
    .returning();
  if (!clientProfile) throw new Error('seed insert into client_profiles did not return a row');

  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Back squat ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning();
  if (!exercise) throw new Error('seed insert into exercises did not return a row');

  const sessionClientLocalId = uuidv7();
  await db.insert(schema.workoutSessions).values({
    clientId: clientProfile.id,
    coachId: coachProfileId,
    scheduledDate: '2026-08-15',
    status: 'in_progress',
    startedAt: new Date('2026-08-15T09:00:00.000Z'),
    clientLocalId: sessionClientLocalId,
  });

  return { clientProfileId: clientProfile.id, exerciseId: exercise.id, sessionClientLocalId };
}

function payload(f: Fixture, overrides: Partial<LogSetInput> = {}): LogSetInput {
  return {
    sessionClientLocalId: f.sessionClientLocalId,
    exerciseId: f.exerciseId,
    clientLocalId: uuidv7(),
    setNumber: 1,
    reps: 10,
    weightKg: 80,
    loggedAt: TAPPED_AT,
    isWarmup: false,
    isFailure: false,
    ...overrides,
  };
}

async function recordsOf(f: Fixture) {
  return db
    .select()
    .from(schema.personalRecords)
    .where(
      and(
        eq(schema.personalRecords.clientId, f.clientProfileId),
        eq(schema.personalRecords.exerciseId, f.exerciseId),
      ),
    )
    .orderBy(schema.personalRecords.recordType);
}

async function setsOf(f: Fixture) {
  return db
    .select()
    .from(schema.setLogs)
    .where(
      and(
        eq(schema.setLogs.clientId, f.clientProfileId),
        eq(schema.setLogs.exerciseId, f.exerciseId),
      ),
    );
}

describe('workouts.logSet — the personal records it reports', () => {
  it('reports all four types for the first working set of an exercise', async () => {
    const f = await fixture();

    const result = await logSet(db, f.clientProfileId, payload(f));

    expect(result.newPersonalRecords).toEqual([
      '1rm_estimated',
      'max_weight',
      'max_reps',
      'max_volume',
    ]);
    expect(await recordsOf(f)).toHaveLength(4);
  });

  it('reports only the types the later set actually beat', async () => {
    const f = await fixture();
    await logSet(db, f.clientProfileId, payload(f));

    // Heavier for fewer reps: takes weight, leaves reps and volume (450 < 800)
    // alone. Epley off 90×5 is 105.00, below 80×10's 106.67, so the 1RM
    // record stands too.
    const result = await logSet(
      db,
      f.clientProfileId,
      payload(f, { setNumber: 2, reps: 5, weightKg: 90 }),
    );

    expect(result.newPersonalRecords).toEqual(['max_weight']);
  });

  it('reports nothing for a set that beats nothing', async () => {
    const f = await fixture();
    await logSet(db, f.clientProfileId, payload(f));

    const result = await logSet(
      db,
      f.clientProfileId,
      payload(f, { setNumber: 2, reps: 8, weightKg: 70 }),
    );

    expect(result.newPersonalRecords).toEqual([]);
  });

  it('reports nothing for a warm-up set, however heavy, and leaves the records standing', async () => {
    const f = await fixture();
    const working = await logSet(db, f.clientProfileId, payload(f));

    const warmup = await logSet(
      db,
      f.clientProfileId,
      payload(f, { setNumber: 2, reps: 20, weightKg: 200, isWarmup: true }),
    );

    expect(warmup.newPersonalRecords).toEqual([]);
    for (const record of await recordsOf(f)) {
      expect(record.setLogId).toBe(working.id);
    }
  });

  it('gives a first-ever warm-up set no records at all', async () => {
    const f = await fixture();

    const result = await logSet(
      db,
      f.clientProfileId,
      payload(f, { reps: 20, weightKg: 200, isWarmup: true }),
    );

    expect(result.newPersonalRecords).toEqual([]);
    expect(await recordsOf(f)).toHaveLength(0);
  });

  it('answers a replay identically — the first response may never have arrived', async () => {
    const f = await fixture();
    const input = payload(f);

    const first = await logSet(db, f.clientProfileId, input);
    const replay = await logSet(db, f.clientProfileId, input);

    // `offline-sync` §3: one row, identical responses. Suppressing the
    // second announcement would lose the celebration outright whenever the
    // first response was the one that died in the tunnel — which is the only
    // reason a replay happens at all. Exactly-once belongs to
    // `personal-records/03`, on the device, keyed on `clientLocalId`.
    expect(first.newPersonalRecords).toHaveLength(4);
    expect(replay).toEqual(first);
    expect(await setsOf(f)).toHaveLength(1);
  });

  it('withdraws a record when an edit lowers the set that held it', async () => {
    const f = await fixture();
    const input = payload(f, { weightKg: 200 });
    await logSet(db, f.clientProfileId, input);

    // `set-entry/05`: the same `clientLocalId` with corrected numbers. A
    // detector that only ever asked "is this bigger than the stored record"
    // would leave the mistyped 200kg standing forever.
    await logSet(db, f.clientProfileId, { ...input, weightKg: 100 });

    const records = Object.fromEntries((await recordsOf(f)).map((r) => [r.recordType, r.value]));
    expect(records['max_weight']).toBe('100.00');
  });

  it('leaves no set log behind when detection fails — one transaction, not two', async () => {
    const f = await fixture();

    await expect(
      logSet(db, f.clientProfileId, payload(f), undefined, () => {
        throw new Error('detection exploded');
      }),
    ).rejects.toThrow('detection exploded');

    // This task's stated risk, inverted: neither half may survive the other.
    expect(await setsOf(f)).toHaveLength(0);
    expect(await recordsOf(f)).toHaveLength(0);
  });

  it('withdraws the record a deleted set held', async () => {
    const f = await fixture();
    const kept = await logSet(db, f.clientProfileId, payload(f));
    const mistake = payload(f, { setNumber: 2, reps: 12, weightKg: 140 });
    await logSet(db, f.clientProfileId, mistake);

    await deleteSet(db, f.clientProfileId, {
      sessionClientLocalId: f.sessionClientLocalId,
      clientLocalId: mistake.clientLocalId,
      deletedAt: new Date('2026-08-15T09:20:00.000Z'),
    });

    // `delete-set.ts`'s own decision (e) named this gap and deferred it to
    // this feature. A record pointing at a set the client says they never
    // did outlives the FK's `ON DELETE SET NULL`, because the row is soft
    // deleted and the FK never fires.
    for (const record of await recordsOf(f)) {
      expect(record.setLogId).toBe(kept.id);
    }
  });

  it('keeps one client out of another client’s records', async () => {
    const mine = await fixture();
    const theirs = await fixture();

    await logSet(db, mine.clientProfileId, payload(mine, { weightKg: 200 }));
    const result = await logSet(
      db,
      theirs.clientProfileId,
      payload(theirs, { weightKg: 60, reps: 3 }),
    );

    // A fresh client's first set is always a clean sweep — someone else's
    // heavier lift on the same exercise is not their record to beat.
    expect(result.newPersonalRecords).toHaveLength(4);
  });
});
