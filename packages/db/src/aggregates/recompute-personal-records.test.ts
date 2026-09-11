// Real Postgres (`testing` skill §4). This file owns the *rule* half of
// `phase-09-workout-logger/personal-records/02`: what qualifies as a
// personal record, which set holds it, and when a record must be withdrawn.
// `apps/api/src/lib/pr-detection.test.ts` owns the other half — which types
// a given set newly took — and deliberately holds no second opinion about
// any of the rules asserted here.
//
// Mocking Drizzle would test the mock: every assertion below is really an
// assertion about one SQL statement's `WHERE`, its `DISTINCT ON` ordering,
// and its `ON CONFLICT` target resolving to the unique index it names.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createDbClient, type DbClient } from '../client.ts';
import {
  createClient,
  createCoach,
  createExercise,
  createWorkoutSession,
} from '../fixtures/builders.ts';
import { personalRecords, setLogs } from '../schema/training.ts';
import type { NewSetLog, PersonalRecord } from '../types.ts';

import { recomputePersonalRecords } from './recompute-personal-records.ts';

let container: StartedTestContainer;
let db: DbClient;
let coachId: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // The real migration set via the real CLI, as a subprocess — same reason
  // `recompute-daily-summary.test.ts` gives at length.
  const migrateScript = path.join(__dirname, '..', 'migrate.ts');
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });

  const { coachProfile } = await createCoach(db);
  coachId = coachProfile.id;
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

const LOGGED_AT = new Date('2026-08-15T09:14:22.000Z');

interface Fixture {
  clientId: string;
  exerciseId: string;
  sessionId: string;
}

async function fixture(): Promise<Fixture> {
  const { clientProfile } = await createClient(db, coachId);
  const exercise = await createExercise(db);
  const session = await createWorkoutSession(db, clientProfile.id, coachId, {
    status: 'in_progress',
  });
  return { clientId: clientProfile.id, exerciseId: exercise.id, sessionId: session.id };
}

/**
 * One logged set. `estimated1rmKg` is supplied explicitly rather than
 * derived here: the column is computed on write by `estimateOneRepMax`
 * (`log-set.ts` decision (d)), and `packages/db` must never grow a second
 * copy of Epley to fill it in (`code-conventions` §1).
 */
async function logSetRow(
  f: Fixture,
  overrides: Partial<NewSetLog> & { setNumber: number },
): Promise<string> {
  const [row] = await db
    .insert(setLogs)
    .values({
      workoutSessionId: f.sessionId,
      exerciseId: f.exerciseId,
      clientId: f.clientId,
      clientLocalId: crypto.randomUUID(),
      reps: 10,
      weightKg: '80.00',
      estimated1rmKg: '106.67',
      isWarmup: false,
      loggedAt: LOGGED_AT,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('set_logs insert did not return a row');
  return row.id;
}

async function recordsOf(f: Fixture): Promise<PersonalRecord[]> {
  return db
    .select()
    .from(personalRecords)
    .where(
      and(eq(personalRecords.clientId, f.clientId), eq(personalRecords.exerciseId, f.exerciseId)),
    )
    .orderBy(personalRecords.recordType);
}

function byType(rows: PersonalRecord[]): Record<string, PersonalRecord> {
  return Object.fromEntries(rows.map((r) => [r.recordType, r]));
}

describe('recomputePersonalRecords — what counts as a record', () => {
  it('writes all four record types from one working set', async () => {
    const f = await fixture();
    const setLogId = await logSetRow(f, { setNumber: 1 });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    expect(Object.keys(records).sort()).toEqual([
      '1rm_estimated',
      'max_reps',
      'max_volume',
      'max_weight',
    ]);
    expect(records['1rm_estimated']).toMatchObject({ value: '106.67', setLogId });
    expect(records['max_weight']).toMatchObject({ value: '80.00', setLogId });
    expect(records['max_reps']).toMatchObject({ value: '10.00', setLogId });
    // 10 × 80 — the same product `recomputeSessionVolume` sums.
    expect(records['max_volume']).toMatchObject({ value: '800.00', setLogId });
    expect(records['max_weight']?.achievedAt).toEqual(LOGGED_AT);
  });

  it('never lets a warm-up set hold a record, however heavy', async () => {
    const f = await fixture();
    const working = await logSetRow(f, { setNumber: 1 });
    await logSetRow(f, {
      setNumber: 2,
      isWarmup: true,
      reps: 20,
      weightKg: '200.00',
      estimated1rmKg: '333.33',
    });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    for (const type of ['1rm_estimated', 'max_weight', 'max_reps', 'max_volume']) {
      expect(records[type]?.setLogId).toBe(working);
    }
  });

  it('never lets a withdrawn set hold a record', async () => {
    const f = await fixture();
    const working = await logSetRow(f, { setNumber: 1 });
    await logSetRow(f, {
      setNumber: 2,
      reps: 12,
      weightKg: '140.00',
      estimated1rmKg: '196.00',
      deletedAt: new Date(),
    });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    expect(byType(await recordsOf(f))['max_weight']?.setLogId).toBe(working);
  });

  it('gives a zero-rep failed attempt no record at all, not even max_weight', async () => {
    const f = await fixture();
    await logSetRow(f, { setNumber: 1, reps: 0, weightKg: '200.00', estimated1rmKg: null });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    expect(await recordsOf(f)).toHaveLength(0);
  });

  it('gives a bodyweight set a reps record and no weight, volume, or 1RM record', async () => {
    const f = await fixture();
    await logSetRow(f, { setNumber: 1, reps: 15, weightKg: null, estimated1rmKg: null });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    expect(Object.keys(records)).toEqual(['max_reps']);
    expect(records['max_reps']?.value).toBe('15.00');
  });

  it('keeps the earlier set on a tie — the record was set then, not again', async () => {
    const f = await fixture();
    const first = await logSetRow(f, { setNumber: 1 });
    await logSetRow(f, { setNumber: 2, loggedAt: new Date(LOGGED_AT.getTime() + 300_000) });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    expect(records['max_weight']?.setLogId).toBe(first);
    expect(records['max_weight']?.achievedAt).toEqual(LOGGED_AT);
  });

  it('moves only the type that was beaten', async () => {
    const f = await fixture();
    const first = await logSetRow(f, { setNumber: 1 });
    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    // Heavier, but for fewer reps: takes weight and 1RM, leaves reps alone,
    // and 90 × 5 = 450 is below 800 so volume stays too.
    const heavier = await logSetRow(f, {
      setNumber: 2,
      reps: 5,
      weightKg: '90.00',
      estimated1rmKg: '105.00',
      loggedAt: new Date(LOGGED_AT.getTime() + 300_000),
    });
    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    expect(records['max_weight']).toMatchObject({ value: '90.00', setLogId: heavier });
    expect(records['max_reps']).toMatchObject({ value: '10.00', setLogId: first });
    expect(records['max_volume']).toMatchObject({ value: '800.00', setLogId: first });
    // 106.67 stands: Epley off 90×5 is lower than off 80×10.
    expect(records['1rm_estimated']).toMatchObject({ value: '106.67', setLogId: first });
  });

  it('withdraws a record whose last qualifying set was deleted', async () => {
    const f = await fixture();
    const only = await logSetRow(f, { setNumber: 1 });
    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));
    expect(await recordsOf(f)).toHaveLength(4);

    await db.update(setLogs).set({ deletedAt: new Date() }).where(eq(setLogs.id, only));
    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    // A record pointing at a set the client says they never did is a lie
    // the FK's `ON DELETE SET NULL` cannot catch — the row is soft-deleted,
    // so the FK never fires.
    expect(await recordsOf(f)).toHaveLength(0);
  });

  it('is scoped to one client and one exercise', async () => {
    const mine = await fixture();
    const theirs = await fixture();
    await logSetRow(mine, { setNumber: 1 });
    await logSetRow(theirs, { setNumber: 1, weightKg: '300.00', estimated1rmKg: '400.00' });

    await db.transaction((tx) => recomputePersonalRecords(tx, mine.clientId, mine.exerciseId));

    expect(byType(await recordsOf(mine))['max_weight']?.value).toBe('80.00');
    expect(await recordsOf(theirs)).toHaveLength(0);
  });

  it('writes nothing that survives a rollback of the caller transaction', async () => {
    const f = await fixture();
    await logSetRow(f, { setNumber: 1 });

    await expect(
      db.transaction(async (tx) => {
        await recomputePersonalRecords(tx, f.clientId, f.exerciseId);
        throw new Error('caller failed after the recompute');
      }),
    ).rejects.toThrow('caller failed after the recompute');

    // DB§8.2's whole point: a PR is never recorded for a write that did not
    // commit (this task's own stated risk).
    expect(await recordsOf(f)).toHaveLength(0);
  });

  it('is idempotent — running twice changes nothing', async () => {
    const f = await fixture();
    await logSetRow(f, { setNumber: 1 });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));
    const first = await recordsOf(f);
    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));
    const second = await recordsOf(f);

    expect(second).toEqual(first);
  });

  it('does not fail the caller over a volume too large for numeric(10,2)', async () => {
    const f = await fixture();
    // 30_000 × 9_999.99 ≈ 3e8, which `numeric(10,2)` cannot hold. Refusing
    // the record is right; raising 22003 and taking the client's whole set
    // down with it is not — the same judgement `estimateOneRepMax` makes at
    // `NUMERIC_6_2_MAX`.
    await logSetRow(f, {
      setNumber: 1,
      reps: 30_000,
      weightKg: '9999.99',
      estimated1rmKg: null,
    });

    await db.transaction((tx) => recomputePersonalRecords(tx, f.clientId, f.exerciseId));

    const records = byType(await recordsOf(f));
    expect(Object.keys(records).sort()).toEqual(['max_reps', 'max_weight']);
  });
});
