// DB§14.3 row one: for `set_logs`, `meals`, `body_metrics` and `habit_logs`
// the device wins — "the client was there; the server was not". The rule is
// not a merge strategy, it is the absence of one: whatever the device sends
// replaces what the server holds, field for field, including fields the
// device cleared. Real Postgres (`testing` skill §4), because the property
// under test is what `ON CONFLICT ... DO UPDATE` actually writes.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { offlineUpsert } from './offline-upsert.ts';

let container: StartedTestContainer;
let db: DbClient;

let coachProfileId: string;
let clientProfileId: string;
let exerciseId: string;
let workoutSessionId: string;
let habitId: string;

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

  // Subprocess, matching `offline-upsert.test.ts` — `migrate.ts` reads
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
      email: `coach-${randomUUID()}@device-wins.test`,
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
      email: `client-${randomUUID()}@device-wins.test`,
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

  const [habit] = await db
    .insert(schema.habits)
    .values({ clientId: clientProfileId, coachId: coachProfileId, name: 'Fixture Habit' })
    .returning();
  if (!habit) throw new Error('fixture: habits insert returned no row');
  habitId = habit.id;
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

describe('device wins — set_logs (DB§14.3)', () => {
  it('replaces every field the device resubmits, including the ones it cleared', async () => {
    const clientLocalId = randomUUID();
    const target = [schema.setLogs.clientId, schema.setLogs.clientLocalId];
    const identity = { workoutSessionId, exerciseId, clientId: clientProfileId, clientLocalId };

    const stored = await offlineUpsert(db, {
      table: schema.setLogs,
      values: {
        ...identity,
        setNumber: 4,
        reps: 10,
        weightKg: '80.00',
        rpe: '9.0',
        rir: 1,
        durationSeconds: 60,
        distanceM: '25.00',
        isWarmup: true,
        isFailure: true,
        notes: 'first attempt',
        estimated1rmKg: '106.67',
        loggedAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      target,
      onConflict: 'update',
    });

    // The device corrects the set: every field differs, and several are
    // cleared outright. A field-level merge would keep the server's old
    // value wherever the device sent null/zero/empty — that is the
    // behaviour DB§14.3 rules out.
    const corrected = await offlineUpsert(db, {
      table: schema.setLogs,
      values: {
        ...identity,
        setNumber: 5,
        reps: 0,
        weightKg: null,
        rpe: null,
        rir: 0,
        durationSeconds: null,
        distanceM: null,
        isWarmup: false,
        isFailure: false,
        notes: '',
        estimated1rmKg: null,
        loggedAt: new Date('2026-09-01T11:30:00.000Z'),
      },
      target,
      onConflict: 'update',
    });

    expect(corrected.id).toBe(stored.id);
    expect(corrected.setNumber).toBe(5);
    expect(corrected.reps).toBe(0);
    expect(corrected.rir).toBe(0);
    expect(corrected.isWarmup).toBe(false);
    expect(corrected.isFailure).toBe(false);
    expect(corrected.notes).toBe('');
    expect(corrected.weightKg).toBeNull();
    expect(corrected.rpe).toBeNull();
    expect(corrected.durationSeconds).toBeNull();
    expect(corrected.distanceM).toBeNull();
    expect(corrected.estimated1rmKg).toBeNull();
    expect(corrected.loggedAt).toEqual(new Date('2026-09-01T11:30:00.000Z'));

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
    expect(rows[0]).toEqual(corrected);
  });
});

describe('device wins — meals (DB§14.3)', () => {
  it('replaces every field the device resubmits, including the ones it cleared', async () => {
    const clientLocalId = randomUUID();
    const target = [schema.meals.clientId, schema.meals.clientLocalId];
    // `coachId` is held constant: `meals_no_owner_change` (migration 0022)
    // rejects an UPDATE that moves it, and device-wins never implies a
    // device may reassign ownership.
    const identity = { clientId: clientProfileId, coachId: coachProfileId, clientLocalId };

    const stored = await offlineUpsert(db, {
      table: schema.meals,
      values: {
        ...identity,
        loggedDate: '2026-09-10',
        mealType: 'lunch',
        notes: 'chicken and rice',
        loggedAt: new Date('2026-09-10T12:00:00.000Z'),
      },
      target,
      onConflict: 'update',
    });

    const corrected = await offlineUpsert(db, {
      table: schema.meals,
      values: {
        ...identity,
        loggedDate: '2026-09-11',
        mealType: 'dinner',
        notes: null,
        loggedAt: new Date('2026-09-11T20:15:00.000Z'),
      },
      target,
      onConflict: 'update',
    });

    expect(corrected.id).toBe(stored.id);
    expect(corrected.loggedDate).toBe('2026-09-11');
    expect(corrected.mealType).toBe('dinner');
    expect(corrected.notes).toBeNull();
    expect(corrected.loggedAt).toEqual(new Date('2026-09-11T20:15:00.000Z'));

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
    expect(rows[0]).toEqual(corrected);
  });
});

describe('device wins — habit_logs (DB§14.3)', () => {
  // `habit_logs` carries no `client_local_id`; its idempotency key is the
  // natural one the table already declares, `habit_logs_habit_date_unique`
  // on (habit_id, date). Device-wins applies to it identically.
  it('a device that un-checks a habit clears the stored true, rather than keeping it', async () => {
    const target = [schema.habitLogs.habitId, schema.habitLogs.date];
    const identity = { habitId, date: '2026-09-12' };

    const stored = await offlineUpsert(db, {
      table: schema.habitLogs,
      values: { ...identity, completed: true },
      target,
      onConflict: 'update',
    });

    const corrected = await offlineUpsert(db, {
      table: schema.habitLogs,
      values: { ...identity, completed: false },
      target,
      onConflict: 'update',
    });

    expect(corrected.id).toBe(stored.id);
    expect(corrected.completed).toBe(false);

    const rows = await db
      .select()
      .from(schema.habitLogs)
      .where(and(eq(schema.habitLogs.habitId, habitId), eq(schema.habitLogs.date, '2026-09-12')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.completed).toBe(false);
  });
});

describe('device wins — a selective `set` is refused (DB§14.3)', () => {
  // The named risk in `sync-engine/02`: a future phase-09/13/18 author
  // narrows `set` to "the fields that change", which reinstates exactly the
  // field-level merge DB§14.3 rules out. `set` is a real escape hatch for
  // the server-wins and last-write-wins rows of that table, so it stays —
  // but not for these four.
  // Every payload below is otherwise valid, so the rejection is the `set`
  // and nothing else.
  it('rejects a caller-supplied `set` on set_logs', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.setLogs,
        values: {
          workoutSessionId,
          exerciseId,
          clientId: clientProfileId,
          clientLocalId: randomUUID(),
          setNumber: 1,
          reps: 5,
        },
        target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
        onConflict: 'update',
        set: { reps: 6 },
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects a caller-supplied `set` on meals', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.meals,
        values: {
          clientId: clientProfileId,
          coachId: coachProfileId,
          clientLocalId: randomUUID(),
          loggedDate: '2026-09-13',
          mealType: 'snack',
        },
        target: [schema.meals.clientId, schema.meals.clientLocalId],
        onConflict: 'update',
        set: { notes: 'edited' },
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects a caller-supplied `set` on body_metrics', async () => {
    // Guarded ahead of the write path existing: `body_metrics` has a
    // `client_local_id` column but no unique index on it yet, so nothing
    // can upsert against it until phase-18 adds one. The rule is in place
    // for whoever does.
    await expect(
      offlineUpsert(db, {
        table: schema.bodyMetrics,
        values: {
          clientId: clientProfileId,
          recordedAt: new Date('2026-09-14T07:00:00.000Z'),
          recordedDate: '2026-09-14',
          weightKg: '80.00',
          clientLocalId: randomUUID(),
        },
        target: [schema.bodyMetrics.clientId, schema.bodyMetrics.clientLocalId],
        onConflict: 'update',
        set: { weightKg: '81.00' },
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('rejects a caller-supplied `set` on habit_logs', async () => {
    await expect(
      offlineUpsert(db, {
        table: schema.habitLogs,
        values: { habitId, date: '2026-09-15', completed: true },
        target: [schema.habitLogs.habitId, schema.habitLogs.date],
        onConflict: 'update',
        set: { completed: false },
      }),
    ).rejects.toThrow(/DB§14\.3/);
  });

  it('still allows a caller-supplied `set` on a table DB§14.3 does not give to the device', async () => {
    // `workout_sessions.status` is last-write-wins, not device-wins, and
    // `sync-engine/04` needs the hatch. The guard must not reach it.
    const clientLocalId = randomUUID();
    const target = [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId];
    const values = {
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-09-20',
      clientLocalId,
    };

    const stored = await offlineUpsert(db, {
      table: schema.workoutSessions,
      values,
      target,
      onConflict: 'update',
    });
    const updated = await offlineUpsert(db, {
      table: schema.workoutSessions,
      values: { ...values, scheduledDate: '2026-09-21' },
      target,
      onConflict: 'update',
      set: { status: 'in_progress' },
    });

    expect(updated.id).toBe(stored.id);
    expect(updated.status).toBe('in_progress');
    // Proof the narrow `set` was honoured rather than ignored: the payload's
    // new scheduledDate was deliberately not among the columns written.
    expect(updated.scheduledDate).toBe('2026-09-20');
  });
});
