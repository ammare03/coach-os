// Real Postgres, real migrated schema (`testing` skill §4). The whole
// point of this helper is that it targets the indexes phase-01 actually
// built — `set_logs_client_local` (plain) and `sessions_client_local`
// (PARTIAL). Scratch tables would prove nothing about either.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { unwrapDatabaseError } from '../db/is-database-error.ts';

import { offlineUpsert } from './offline-upsert.ts';

let container: StartedTestContainer;
let db: DbClient;

let coachProfileId: string;
let clientProfileId: string;
let exerciseId: string;
let workoutSessionId: string;

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

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // Subprocess, matching `__tests__/authz.test.ts` — `migrate.ts` reads
  // `import.meta.url`, which ts-jest's CommonJS transpile cannot execute.
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
    env: { ...process.env },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });

  const [coachUser] = await db
    .insert(schema.users)
    .values({
      email: `coach-${randomUUID()}@offline-upsert.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
    })
    .returning();
  if (!coachUser) throw new Error('fixture: users insert returned no row');

  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: coachUser.id })
    .returning();
  if (!coachProfile) throw new Error('fixture: coach_profiles insert returned no row');
  coachProfileId = coachProfile.id;

  const [clientUser] = await db
    .insert(schema.users)
    .values({
      email: `client-${randomUUID()}@offline-upsert.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
    })
    .returning();
  if (!clientUser) throw new Error('fixture: users insert returned no row');

  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: clientUser.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
    })
    .returning();
  if (!clientProfile) throw new Error('fixture: client_profiles insert returned no row');
  clientProfileId = clientProfile.id;

  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Fixture Exercise ${randomUUID()}`,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning();
  if (!exercise) throw new Error('fixture: exercises insert returned no row');
  exerciseId = exercise.id;

  const [session] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-09-01',
    })
    .returning();
  if (!session) throw new Error('fixture: workout_sessions insert returned no row');
  workoutSessionId = session.id;
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

const REPLAYS = 10;

/**
 * Every column except `updated_at`. `platform.touch_updated_at`
 * (migration 0021) bumps that on every UPDATE, so a `DO UPDATE` replay
 * necessarily moves it — "ten identical responses" (DB§14.1) means every
 * column the caller's payload describes, not the housekeeping timestamp
 * the database owns.
 */
function stable(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  delete copy.updatedAt;
  return copy;
}

describe('offlineUpsert — a plain unique index (set_logs_client_local)', () => {
  it('replaying an identical payload ten times produces one row and ten identical responses', async () => {
    const clientLocalId = randomUUID();
    const values = {
      workoutSessionId,
      exerciseId,
      clientId: clientProfileId,
      setNumber: 1,
      reps: 5,
      weightKg: '100.00',
      clientLocalId,
    };

    const responses = [];
    for (let attempt = 0; attempt < REPLAYS; attempt += 1) {
      responses.push(
        await offlineUpsert(db, {
          table: schema.setLogs,
          values,
          target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
          onConflict: 'update',
        }),
      );
    }

    const [first] = responses;
    if (!first) throw new Error('no responses');
    for (const response of responses) {
      expect(stable(response)).toEqual(stable(first));
    }

    const rows = await db
      .select()
      .from(schema.setLogs)
      .where(
        and(
          eq(schema.setLogs.clientId, clientProfileId),
          eq(schema.setLogs.clientLocalId, clientLocalId),
        ),
      );
    expect(rows).toHaveLength(1);
    // Nothing accumulated: same row, same identity, same creation time.
    expect(rows[0]?.id).toBe(first.id);
    expect(rows[0]?.createdAt).toEqual(first.createdAt);
  });

  it('a changed payload for the same clientLocalId updates in place, never inserts a second row', async () => {
    const clientLocalId = randomUUID();
    const base = {
      workoutSessionId,
      exerciseId,
      clientId: clientProfileId,
      setNumber: 2,
      reps: 5,
      weightKg: '100.00',
      clientLocalId,
    };

    const inserted = await offlineUpsert(db, {
      table: schema.setLogs,
      values: base,
      target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
      onConflict: 'update',
    });
    const corrected = await offlineUpsert(db, {
      table: schema.setLogs,
      values: { ...base, reps: 6, weightKg: '102.50' },
      target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
      onConflict: 'update',
    });

    expect(corrected.id).toBe(inserted.id);
    expect(corrected.reps).toBe(6);
    expect(corrected.weightKg).toBe('102.50');

    const rows = await db
      .select()
      .from(schema.setLogs)
      .where(
        and(
          eq(schema.setLogs.clientId, clientProfileId),
          eq(schema.setLogs.clientLocalId, clientLocalId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});

describe('offlineUpsert — a second, differently-shaped table (meals_client_local)', () => {
  it('replaying an identical payload ten times produces one row and ten identical responses', async () => {
    const clientLocalId = randomUUID();
    const values = {
      clientId: clientProfileId,
      coachId: coachProfileId,
      loggedDate: '2026-09-01',
      mealType: 'breakfast' as const,
      notes: 'oats',
      clientLocalId,
    };

    const responses = [];
    for (let attempt = 0; attempt < REPLAYS; attempt += 1) {
      responses.push(
        await offlineUpsert(db, {
          table: schema.meals,
          values,
          target: [schema.meals.clientId, schema.meals.clientLocalId],
          onConflict: 'update',
        }),
      );
    }

    const [first] = responses;
    if (!first) throw new Error('no responses');
    for (const response of responses) {
      expect(stable(response)).toEqual(stable(first));
    }

    const rows = await db
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.clientId, clientProfileId),
          eq(schema.meals.clientLocalId, clientLocalId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
    expect(rows[0]?.createdAt).toEqual(first.createdAt);
  });
});

describe('offlineUpsert — a PARTIAL unique index (sessions_client_local)', () => {
  it('replaying an identical payload ten times produces one row and ten identical responses', async () => {
    const clientLocalId = randomUUID();
    const values = {
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-09-02',
      clientLocalId,
    };

    const responses = [];
    for (let attempt = 0; attempt < REPLAYS; attempt += 1) {
      responses.push(
        await offlineUpsert(db, {
          table: schema.workoutSessions,
          values,
          target: [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId],
          onConflict: 'update',
        }),
      );
    }

    const [first] = responses;
    if (!first) throw new Error('no responses');
    for (const response of responses) {
      expect(stable(response)).toEqual(stable(first));
    }

    const rows = await db
      .select()
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.clientId, clientProfileId),
          eq(schema.workoutSessions.clientLocalId, clientLocalId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.id);
  });

  it('supplies the index predicate itself — the same insert without one is rejected by Postgres', async () => {
    // The named risk, as a negative control: `sessions_client_local` is
    // partial, so an inference clause missing `WHERE client_local_id IS NOT
    // NULL` matches no index at all (42P10). The test above passes because
    // the helper derives that predicate, not by luck.
    const thrown: unknown = await db
      .insert(schema.workoutSessions)
      .values({
        clientId: clientProfileId,
        coachId: coachProfileId,
        scheduledDate: '2026-09-03',
        clientLocalId: randomUUID(),
      })
      .onConflictDoUpdate({
        target: [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId],
        set: { scheduledDate: '2026-09-03' },
      })
      .returning()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(unwrapDatabaseError(thrown)?.code).toBe('42P10');
  });

  it('inserts every row whose clientLocalId is null — the partial index excludes them', async () => {
    const values = {
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-09-04',
      clientLocalId: null,
    };

    const one = await offlineUpsert(db, {
      table: schema.workoutSessions,
      values,
      target: [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId],
      onConflict: 'update',
    });
    const two = await offlineUpsert(db, {
      table: schema.workoutSessions,
      values,
      target: [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId],
      onConflict: 'update',
    });

    expect(two.id).not.toBe(one.id);

    const rows = await db
      .select()
      .from(schema.workoutSessions)
      .where(
        and(
          eq(schema.workoutSessions.clientId, clientProfileId),
          isNull(schema.workoutSessions.clientLocalId),
          eq(schema.workoutSessions.scheduledDate, '2026-09-04'),
        ),
      );
    expect(rows).toHaveLength(2);
  });
});

// `water_logs`, not `set_logs`: the mode is refused outright for DB§14.3's
// four (below), and these two prove the mechanism, not the table. It is a
// plain unique index on `(client_id, client_local_id)` like `set_logs`, and
// carries the same migration-0021 `touch_updated_at` trigger, so the
// updated_at assertion still bites.
describe("offlineUpsert — onConflict: 'ignore' (water_logs)", () => {
  it('returns the stored row unchanged and leaves updatedAt alone', async () => {
    const clientLocalId = randomUUID();
    const values = {
      clientId: clientProfileId,
      loggedDate: '2026-09-05',
      amountMl: 500,
      clientLocalId,
    };

    const inserted = await offlineUpsert(db, {
      table: schema.waterLogs,
      values,
      target: [schema.waterLogs.clientId, schema.waterLogs.clientLocalId],
      onConflict: 'ignore',
    });

    const replayed = await offlineUpsert(db, {
      table: schema.waterLogs,
      values: { ...values, amountMl: 990 },
      target: [schema.waterLogs.clientId, schema.waterLogs.clientLocalId],
      onConflict: 'ignore',
    });

    // First write wins, and the replay is a true no-op — updated_at
    // included, which `onConflict: 'update'` cannot promise.
    expect(replayed).toEqual(inserted);
    expect(replayed.amountMl).toBe(500);
  });

  it('resolves two concurrent replays to the same single row', async () => {
    const clientLocalId = randomUUID();
    const values = {
      clientId: clientProfileId,
      loggedDate: '2026-09-06',
      amountMl: 250,
      clientLocalId,
    };
    const args = {
      table: schema.waterLogs,
      values,
      target: [schema.waterLogs.clientId, schema.waterLogs.clientLocalId],
      onConflict: 'ignore' as const,
    };

    const [a, b] = await Promise.all([offlineUpsert(db, args), offlineUpsert(db, args)]);

    expect(a?.id).toBe(b?.id);

    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.waterLogs)
      .where(
        and(
          eq(schema.waterLogs.clientId, clientProfileId),
          eq(schema.waterLogs.clientLocalId, clientLocalId),
        ),
      );
    expect(rows[0]?.count).toBe(1);
  });
});

describe("offlineUpsert — onConflict: 'ignore' is refused for device-wins tables (DB§14.3)", () => {
  // `DO NOTHING` keeps the server's row and discards the device's newer
  // submission — the inversion of "the client was there; the server was
  // not", and a total discard rather than the partial one a selective
  // `set` would make.
  it('rejects ignore on set_logs', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.setLogs,
        values: {
          workoutSessionId,
          exerciseId,
          clientId: clientProfileId,
          setNumber: 1,
          reps: 5,
          clientLocalId: randomUUID(),
        },
        target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
        onConflict: 'ignore',
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects ignore on meals', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.meals,
        values: {
          clientId: clientProfileId,
          coachId: coachProfileId,
          loggedDate: '2026-09-20',
          mealType: 'lunch',
          clientLocalId: randomUUID(),
        },
        target: [schema.meals.clientId, schema.meals.clientLocalId],
        onConflict: 'ignore',
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects ignore on body_metrics', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.bodyMetrics,
        values: {
          clientId: clientProfileId,
          recordedAt: new Date('2026-09-20T07:00:00.000Z'),
          recordedDate: '2026-09-20',
          weightKg: '80.00',
          source: 'manual',
          clientLocalId: randomUUID(),
        },
        target: [schema.bodyMetrics.clientId, schema.bodyMetrics.clientLocalId],
        onConflict: 'ignore',
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects ignore on habit_logs', async () => {
    // The guard fires before any statement runs, so an unseeded habit id
    // is enough — a reachable insert would be the bug this test forbids.
    await expect(
      offlineUpsert(db, {
        table: schema.habitLogs,
        values: { habitId: randomUUID(), date: '2026-09-20', completed: true },
        target: [schema.habitLogs.habitId, schema.habitLogs.date],
        onConflict: 'ignore',
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });
});
