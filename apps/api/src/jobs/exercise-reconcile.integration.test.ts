// Real Postgres (`testing` skill §4). Every claim this job makes is a claim
// about a query, a foreign key, or a constraint — "the rename reached the
// charts", "the completed snapshot did not move", "the orphan check would
// have caught a dropped FK" — and none of them survives being asserted
// against a mocked Drizzle client. Pass 3's test literally drops a foreign
// key, which is only meaningful against a real one.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type {
  assertReferentialIntegrity as AssertReferentialIntegrity,
  findArchivedButPrescribed as FindArchivedButPrescribed,
  findDuplicateCandidates as FindDuplicateCandidates,
  refreshStaleDisplayNames as RefreshStaleDisplayNames,
} from '../services/exercises/reconcile.ts';

import type {
  runExerciseReconcile as RunExerciseReconcile,
  runExerciseReconcileSweep as RunExerciseReconcileSweep,
} from './exercise-reconcile.ts';

// Pass 3 alerts through `dispatchAlert`, which posts to Resend and Expo over
// real `fetch`. Stubbed at the boundary, same reasoning as
// `purge-account.test.ts`'s R2 mock: this suite proves the alert *fires*,
// not that a third party received it.
const dispatchAlert = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/alerts.ts', () => ({
  dispatchAlert: (alert: unknown) => dispatchAlert(alert),
}));

// The fan-out talks to Redis; there is none here, and its behaviour under
// test is "one enqueue per coach, all carrying the same week", not BullMQ's
// own dedup (which `../queues/enqueue.test.ts` covers against a real Redis).
const enqueueExerciseReconcile = jest.fn().mockResolvedValue(undefined);
jest.mock('../queues/enqueue.ts', () => ({
  enqueueExerciseReconcile: (data: unknown) => enqueueExerciseReconcile(data),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let findArchivedButPrescribed: typeof FindArchivedButPrescribed;
let refreshStaleDisplayNames: typeof RefreshStaleDisplayNames;
let assertReferentialIntegrity: typeof AssertReferentialIntegrity;
let findDuplicateCandidates: typeof FindDuplicateCandidates;
let runExerciseReconcile: typeof RunExerciseReconcile;
let runExerciseReconcileSweep: typeof RunExerciseReconcileSweep;

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

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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

  ({
    findArchivedButPrescribed,
    refreshStaleDisplayNames,
    assertReferentialIntegrity,
    findDuplicateCandidates,
  } = await import('../services/exercises/reconcile.ts'));
  ({ runExerciseReconcile, runExerciseReconcileSweep } = await import('./exercise-reconcile.ts'));
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

beforeEach(() => {
  dispatchAlert.mockClear();
  enqueueExerciseReconcile.mockClear();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

interface Coach {
  userId: string;
  profileId: string;
}

async function insertCoach(): Promise<Coach> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@exercise-reconcile-test.com`,
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
  return { userId: user.id, profileId: profile.id };
}

async function insertClient(coachProfileId: string): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@exercise-reconcile-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, coachId: coachProfileId })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  return profile.id;
}

async function insertExercise(
  coachProfileId: string,
  name: string,
  overrides: Partial<typeof schema.exercises.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.exercises)
    .values({
      coachId: coachProfileId,
      name,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat',
      ...overrides,
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

/** One program, one week, one day, one prescribed exercise. */
async function insertProgramWithExercise(
  coachProfileId: string,
  programName: string,
  exerciseId: string,
): Promise<{ programId: string; programExerciseId: string }> {
  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: coachProfileId, name: programName, durationWeeks: 4 })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

  const [week] = await db
    .insert(schema.programWeeks)
    .values({ programId: program.id, weekNumber: 1 })
    .returning({ id: schema.programWeeks.id });
  if (!week) throw new Error('seed insert into program_weeks did not return a row');

  const [day] = await db
    .insert(schema.programDays)
    .values({ programWeekId: week.id, dayNumber: 1, name: 'Lower A' })
    .returning({ id: schema.programDays.id });
  if (!day) throw new Error('seed insert into program_days did not return a row');

  const [prescription] = await db
    .insert(schema.programExercises)
    .values({ programDayId: day.id, exerciseId, orderIndex: 1, targetSets: 3 })
    .returning({ id: schema.programExercises.id });
  if (!prescription) throw new Error('seed insert into program_exercises did not return a row');

  return { programId: program.id, programExerciseId: prescription.id };
}

function snapshotWith(exerciseId: string, name: string) {
  return {
    dayName: 'Push A',
    exercises: [{ exerciseId, name, targetSets: 3, targetRepsMin: 6, targetRepsMax: 10 }],
  };
}

async function insertSession(input: {
  clientId: string;
  coachProfileId: string;
  status: 'scheduled' | 'completed';
  scheduledDate: string;
  programSnapshot: unknown;
}): Promise<string> {
  seq += 1;
  const completed = input.status === 'completed';
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: input.clientId,
      coachId: input.coachProfileId,
      scheduledDate: input.scheduledDate,
      status: input.status,
      // `session_completion` CHECK: a completed session must carry both.
      startedAt: completed ? new Date('2026-08-31T09:00:00Z') : null,
      completedAt: completed ? new Date('2026-08-31T10:00:00Z') : null,
      programSnapshot: input.programSnapshot,
      clientLocalId: `session-${seq}`,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return row.id;
}

// ---------------------------------------------------------------------------
// Pass 1
// ---------------------------------------------------------------------------

describe('pass 1 — archived exercises still prescribed', () => {
  it('reports every program and day, changes none of them, and digests once', async () => {
    const coach = await insertCoach();
    const exerciseId = await insertExercise(coach.profileId, `Archived Movement ${seq}`);
    const first = await insertProgramWithExercise(coach.profileId, `Alpha ${seq}`, exerciseId);
    const second = await insertProgramWithExercise(coach.profileId, `Bravo ${seq}`, exerciseId);

    await db
      .update(schema.exercises)
      .set({ archivedAt: new Date() })
      .where(eq(schema.exercises.id, exerciseId));

    const findings = await findArchivedButPrescribed(db, coach.profileId);

    expect(findings).toHaveLength(2);
    expect(findings.map((row) => row.programId).sort()).toEqual(
      [first.programId, second.programId].sort(),
    );
    expect(findings.every((row) => row.exerciseId === exerciseId)).toBe(true);
    expect(findings.every((row) => row.weekNumber === 1 && row.dayNumber === 1)).toBe(true);

    // Never auto-swaps: both prescriptions still point at the archived row.
    const prescriptions = await db
      .select({ exerciseId: schema.programExercises.exerciseId })
      .from(schema.programExercises)
      .where(
        inArray(schema.programExercises.id, [first.programExerciseId, second.programExerciseId]),
      );
    expect(prescriptions).toHaveLength(2);
    expect(prescriptions.every((row) => row.exerciseId === exerciseId)).toBe(true);

    const result = await runExerciseReconcile(db, {
      coachId: coach.profileId,
      isoWeek: '2026-W36',
    });
    expect(result.digestSent).toBe(true);
    expect(result.failedPasses).toEqual([]);

    const digests = await db
      .select({ id: schema.notifications.id, body: schema.notifications.body })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, coach.userId));
    expect(digests).toHaveLength(1);
    expect(digests[0]?.body).toContain('2 programs still use an exercise you archived.');
  });

  it('does not report an exercise archived out of an archived program', async () => {
    const coach = await insertCoach();
    const exerciseId = await insertExercise(coach.profileId, `Retired Movement ${seq}`);
    const { programId } = await insertProgramWithExercise(
      coach.profileId,
      `Charlie ${seq}`,
      exerciseId,
    );

    await db
      .update(schema.exercises)
      .set({ archivedAt: new Date() })
      .where(eq(schema.exercises.id, exerciseId));
    await db
      .update(schema.programs)
      .set({ archivedAt: new Date() })
      .where(eq(schema.programs.id, programId));

    expect(await findArchivedButPrescribed(db, coach.profileId)).toEqual([]);
  });

  it('sends no digest when there is nothing to report', async () => {
    const coach = await insertCoach();
    await insertExercise(coach.profileId, `Healthy Movement ${seq}`);

    const result = await runExerciseReconcile(db, {
      coachId: coach.profileId,
      isoWeek: '2026-W36',
    });

    expect(result.archivedInUse).toEqual([]);
    expect(result.duplicateCandidates).toEqual([]);
    expect(result.digestSent).toBe(false);
    expect(
      await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, coach.userId)),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pass 2
// ---------------------------------------------------------------------------

describe('pass 2 — a rename with 200 historical set logs', () => {
  const OLD_NAME_PREFIX = 'DB Bench';
  const NEW_NAME_PREFIX = 'Dumbbell Bench Press';

  it('leaves every log resolving, charts on the new name, and the completed snapshot untouched', async () => {
    const coach = await insertCoach();
    const clientId = await insertClient(coach.profileId);
    const oldName = `${OLD_NAME_PREFIX} ${seq}`;
    const newName = `${NEW_NAME_PREFIX} ${seq}`;
    const exerciseId = await insertExercise(coach.profileId, oldName, {
      movementPattern: 'push',
      equipment: `dumbbell-${seq}`,
    });

    const completedSessionId = await insertSession({
      clientId,
      coachProfileId: coach.profileId,
      status: 'completed',
      scheduledDate: '2026-08-31',
      programSnapshot: snapshotWith(exerciseId, oldName),
    });
    const scheduledSessionId = await insertSession({
      clientId,
      coachProfileId: coach.profileId,
      status: 'scheduled',
      scheduledDate: '2026-09-07',
      programSnapshot: snapshotWith(exerciseId, oldName),
    });

    await db.insert(schema.setLogs).values(
      Array.from({ length: 200 }, (_, index) => ({
        workoutSessionId: completedSessionId,
        exerciseId,
        clientId,
        setNumber: (index % 5) + 1,
        reps: 8,
        weightKg: '60.00',
        clientLocalId: `set-${completedSessionId}-${index}`,
      })),
    );

    await db
      .update(schema.exercises)
      .set({ name: newName })
      .where(eq(schema.exercises.id, exerciseId));

    const refreshed = await refreshStaleDisplayNames(db, coach.profileId);

    // Only the session still ahead of the client was rewritten.
    expect(refreshed.map((row) => row.sessionId)).toEqual([scheduledSessionId]);

    // The chart query — set_logs joined to exercises — is what a coach's
    // history renders from, and the rename reaches it for free because the
    // FK is on the id, not the name (Approach step 6). All 200 still
    // resolve: an INNER JOIN losing rows is exactly the orphan pass 3 exists
    // to catch.
    const charted = await db
      .select({ name: schema.exercises.name })
      .from(schema.setLogs)
      .innerJoin(schema.exercises, eq(schema.exercises.id, schema.setLogs.exerciseId))
      .where(eq(schema.setLogs.workoutSessionId, completedSessionId));
    expect(charted).toHaveLength(200);
    expect(new Set(charted.map((row) => row.name))).toEqual(new Set([newName]));

    // The historical record of what was prescribed is byte-identical.
    const [completed] = await db
      .select({ snapshot: schema.workoutSessions.programSnapshot })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, completedSessionId));
    expect(completed?.snapshot).toEqual(snapshotWith(exerciseId, oldName));

    // The session still ahead shows the current name.
    const [scheduled] = await db
      .select({ snapshot: schema.workoutSessions.programSnapshot })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, scheduledSessionId));
    expect(scheduled?.snapshot).toEqual(snapshotWith(exerciseId, newName));

    // No pass touches set_logs or personal_records. Ever.
    const [setCount] = await db
      .select({ count: sql<string>`count(*)::text` })
      .from(schema.setLogs)
      .where(eq(schema.setLogs.workoutSessionId, completedSessionId));
    expect(Number(setCount?.count ?? 0)).toBe(200);
  }, 60_000);

  it('is a no-op when a snapshot carries no denormalised name', async () => {
    const coach = await insertCoach();
    const clientId = await insertClient(coach.profileId);
    const exerciseId = await insertExercise(coach.profileId, `Nameless Snapshot ${seq}`, {
      equipment: `machine-${seq}`,
    });
    // The shape the only writer in the repo today actually produces
    // (`packages/db/src/seed/training-history.ts`): ids and targets, no name.
    const snapshot = { dayName: 'Lower A', exercises: [{ exerciseId, targetSets: 3 }] };
    const sessionId = await insertSession({
      clientId,
      coachProfileId: coach.profileId,
      status: 'scheduled',
      scheduledDate: '2026-09-14',
      programSnapshot: snapshot,
    });

    await db
      .update(schema.exercises)
      .set({ name: `Renamed Nameless ${seq}` })
      .where(eq(schema.exercises.id, exerciseId));

    expect(await refreshStaleDisplayNames(db, coach.profileId)).toEqual([]);

    const [after] = await db
      .select({ snapshot: schema.workoutSessions.programSnapshot })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, sessionId));
    // No key invented — the pass refreshes a name it finds, never adds one.
    expect(after?.snapshot).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Pass 3
// ---------------------------------------------------------------------------

describe('pass 3 — referential integrity', () => {
  it('finds nothing and alerts nothing on a healthy database', async () => {
    expect(await assertReferentialIntegrity(db)).toEqual([]);
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  it('alerts P1 when a dropped foreign key has let an orphan through', async () => {
    const coach = await insertCoach();
    const clientId = await insertClient(coach.profileId);
    const exerciseId = await insertExercise(coach.profileId, `Orphan Source ${seq}`, {
      equipment: `cable-${seq}`,
    });
    const sessionId = await insertSession({
      clientId,
      coachProfileId: coach.profileId,
      status: 'scheduled',
      scheduledDate: '2026-09-21',
      programSnapshot: null,
    });

    const [constraint] = await db.execute(sql`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'training.set_logs'::regclass
        AND contype = 'f'
        AND confrelid = 'training.exercises'::regclass
    `);
    const constraintName = (constraint as { conname?: unknown } | undefined)?.conname;
    if (typeof constraintName !== 'string') {
      throw new Error('expected a foreign key from training.set_logs to training.exercises');
    }
    const orphanLocalId = `orphan-${sessionId}`;

    try {
      await db.execute(
        sql`ALTER TABLE training.set_logs DROP CONSTRAINT ${sql.identifier(constraintName)}`,
      );
      await db.insert(schema.setLogs).values({
        workoutSessionId: sessionId,
        // No such exercise — impossible while the FK exists, which is the
        // entire point of the pass.
        exerciseId: randomUUID(),
        clientId,
        setNumber: 1,
        reps: 5,
        clientLocalId: orphanLocalId,
      });

      const findings = await assertReferentialIntegrity(db);

      expect(findings).toEqual([{ table: 'set_logs', orphanCount: 1 }]);
      expect(dispatchAlert).toHaveBeenCalledTimes(1);
      expect(dispatchAlert).toHaveBeenCalledWith(
        expect.objectContaining({ alertId: 'P1', summary: expect.stringContaining('set_logs') }),
      );
    } finally {
      await db.delete(schema.setLogs).where(eq(schema.setLogs.clientLocalId, orphanLocalId));
      await db.execute(sql`
        ALTER TABLE training.set_logs
        ADD CONSTRAINT ${sql.identifier(constraintName)}
        FOREIGN KEY (exercise_id) REFERENCES training.exercises(id) ON DELETE RESTRICT
      `);
    }

    // And the healthy state is restored, so no later run alerts on it.
    expect(await assertReferentialIntegrity(db)).toEqual([]);
    expect(exerciseId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pass 4
// ---------------------------------------------------------------------------

describe('pass 4 — duplicate candidates', () => {
  it('reports the pair and merges nothing', async () => {
    const coach = await insertCoach();
    const equipment = `bodyweight-${seq}`;
    const firstId = await insertExercise(coach.profileId, 'Bulgarian Split Squat', {
      equipment,
      movementPattern: 'squat',
    });
    const secondId = await insertExercise(coach.profileId, 'bulgarian split squats', {
      equipment,
      movementPattern: 'squat',
    });

    const pairs = await findDuplicateCandidates(db, coach.profileId);

    expect(pairs).toHaveLength(1);
    expect([pairs[0]?.firstId, pairs[0]?.secondId].sort()).toEqual([firstId, secondId].sort());
    expect(pairs[0]?.editDistance).toBe(1);

    // Never merges: both rows are still there, both still live.
    const rows = await db
      .select({ id: schema.exercises.id, archivedAt: schema.exercises.archivedAt })
      .from(schema.exercises)
      .where(eq(schema.exercises.equipment, equipment));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.archivedAt === null)).toBe(true);
  });

  it('does not pair two genuinely different variations', async () => {
    const coach = await insertCoach();
    const equipment = `barbell-${seq}`;
    await insertExercise(coach.profileId, 'Incline Press', {
      equipment,
      movementPattern: 'push',
    });
    await insertExercise(coach.profileId, 'Decline Press', {
      equipment,
      movementPattern: 'push',
    });

    expect(await findDuplicateCandidates(db, coach.profileId)).toEqual([]);
  });

  it('never pairs across coaches, and never looks at the global library', async () => {
    const mine = await insertCoach();
    const theirs = await insertCoach();
    const equipment = `kettlebell-${seq}`;
    await insertExercise(mine.profileId, 'Goblet Squat', { equipment });
    await insertExercise(theirs.profileId, 'Goblet Squats', { equipment });
    // A global row (`coach_id IS NULL`) with a near-identical name is not a
    // duplicate the coach can act on — they cannot edit or merge a seed row.
    await db.insert(schema.exercises).values({
      coachId: null,
      name: 'Goblet Squatt',
      primaryMuscle: 'quadriceps',
      equipment,
      movementPattern: 'squat',
    });

    expect(await findDuplicateCandidates(db, mine.profileId)).toEqual([]);
    expect(await findDuplicateCandidates(db, theirs.profileId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

describe('runExerciseReconcile', () => {
  it('produces one digest when run twice in the same ISO week', async () => {
    const coach = await insertCoach();
    const exerciseId = await insertExercise(coach.profileId, `Twice Run ${seq}`, {
      equipment: `band-${seq}`,
    });
    await insertProgramWithExercise(coach.profileId, `Delta ${seq}`, exerciseId);
    await db
      .update(schema.exercises)
      .set({ archivedAt: new Date() })
      .where(eq(schema.exercises.id, exerciseId));

    const first = await runExerciseReconcile(db, { coachId: coach.profileId, isoWeek: '2026-W40' });
    const second = await runExerciseReconcile(db, {
      coachId: coach.profileId,
      isoWeek: '2026-W40',
    });

    expect(first.digestSent).toBe(true);
    expect(second.digestSent).toBe(false);
    // The second run still *found* the same thing — it just did not say it
    // twice.
    expect(second.archivedInUse).toHaveLength(1);

    const digests = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, coach.userId),
          eq(schema.notifications.type, 'exercise_reconcile'),
        ),
      );
    expect(digests).toHaveLength(1);
  });

  it('digests again the following week', async () => {
    const coach = await insertCoach();
    const exerciseId = await insertExercise(coach.profileId, `Next Week ${seq}`, {
      equipment: `chain-${seq}`,
    });
    await insertProgramWithExercise(coach.profileId, `Echo ${seq}`, exerciseId);
    await db
      .update(schema.exercises)
      .set({ archivedAt: new Date() })
      .where(eq(schema.exercises.id, exerciseId));

    await runExerciseReconcile(db, { coachId: coach.profileId, isoWeek: '2026-W41' });
    const next = await runExerciseReconcile(db, { coachId: coach.profileId, isoWeek: '2026-W42' });

    expect(next.digestSent).toBe(true);
  });

  it('still reports pass 1 when pass 4 fails outright', async () => {
    const coach = await insertCoach();
    const exerciseId = await insertExercise(coach.profileId, `Independent ${seq}`, {
      equipment: `sled-${seq}`,
    });
    await insertProgramWithExercise(coach.profileId, `Foxtrot ${seq}`, exerciseId);
    await db
      .update(schema.exercises)
      .set({ archivedAt: new Date() })
      .where(eq(schema.exercises.id, exerciseId));

    // A genuine failure rather than a mock: pass 4 is the only pass that
    // reads `movement_pattern`, so renaming the column breaks exactly that
    // one query and leaves passes 1, 2, and 3 untouched.
    await db.execute(
      sql`ALTER TABLE training.exercises RENAME COLUMN movement_pattern TO movement_pattern_tmp`,
    );
    try {
      const result = await runExerciseReconcile(db, {
        coachId: coach.profileId,
        isoWeek: '2026-W43',
      });

      expect(result.failedPasses).toEqual(['duplicate_candidates']);
      expect(result.archivedInUse).toHaveLength(1);
      expect(result.digestSent).toBe(true);
    } finally {
      await db.execute(
        sql`ALTER TABLE training.exercises RENAME COLUMN movement_pattern_tmp TO movement_pattern`,
      );
    }
  });
});

describe('runExerciseReconcileSweep', () => {
  it('enqueues one job per coach, all on the same ISO week', async () => {
    await insertCoach();
    await insertCoach();

    const count = await runExerciseReconcileSweep(db, new Date('2026-09-06T03:00:00Z'));

    expect(count).toBeGreaterThanOrEqual(2);
    expect(enqueueExerciseReconcile).toHaveBeenCalledTimes(count);
    for (const call of enqueueExerciseReconcile.mock.calls) {
      expect(call[0]).toMatchObject({ isoWeek: '2026-W36' });
    }
    const coachIds = enqueueExerciseReconcile.mock.calls.map(
      (call) => (call[0] as { coachId: string }).coachId,
    );
    expect(new Set(coachIds).size).toBe(coachIds.length);
  });
});
