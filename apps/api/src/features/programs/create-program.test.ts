// Real Postgres (`testing` skill §4). This procedure's whole reason to
// exist is that its rows must be indistinguishable from what P07's full
// builder will write — a mocked Drizzle proves nothing about that, and it
// is a four-table transaction against real CHECK constraints.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { asc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createProgram as CreateProgram } from './create-program.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let createProgram: typeof CreateProgram;

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
  ({ createProgram } = await import('./create-program.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

async function insertCoach(): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@create-program-test.com`,
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

async function insertExercise(name: string): Promise<string> {
  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name,
      primaryMuscle: 'quadriceps',
      equipment: 'Barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

/** The whole tree, in the order the builder would read it back. */
async function readProgram(programId: string) {
  const [program] = await db
    .select()
    .from(schema.programs)
    .where(eq(schema.programs.id, programId));
  const weeks = await db
    .select()
    .from(schema.programWeeks)
    .where(eq(schema.programWeeks.programId, programId))
    .orderBy(asc(schema.programWeeks.weekNumber));
  const days = weeks[0]
    ? await db
        .select()
        .from(schema.programDays)
        .where(eq(schema.programDays.programWeekId, weeks[0].id))
        .orderBy(asc(schema.programDays.dayNumber))
    : [];
  return { program, weeks, days };
}

describe('createProgram', () => {
  it('writes a real one-week program, its days, and their exercises', async () => {
    const coachProfileId = await insertCoach();
    const squat = await insertExercise(`Squat ${seq}`);
    const bench = await insertExercise(`Bench ${seq}`);

    const { id } = await createProgram(db, coachProfileId, {
      name: 'Foundation',
      days: [
        {
          name: 'Push',
          exercises: [
            { exerciseId: bench, targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 },
            { exerciseId: squat, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12 },
          ],
        },
        { name: 'Pull', exercises: [] },
      ],
    });

    const { program, weeks, days } = await readProgram(id);
    expect(program?.name).toBe('Foundation');
    expect(program?.coachId).toBe(coachProfileId);
    expect(program?.durationWeeks).toBe(1);
    expect(weeks.map((w) => w.weekNumber)).toEqual([1]);
    expect(days.map((d) => [d.dayNumber, d.name])).toEqual([
      [1, 'Push'],
      [2, 'Pull'],
    ]);

    const first = days[0];
    if (!first) throw new Error('expected a first day');
    const exercises = await db
      .select()
      .from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, first.id))
      .orderBy(asc(schema.programExercises.orderIndex));
    // Order is the order the coach added them, 1-based to match the seed.
    expect(exercises.map((e) => [e.orderIndex, e.exerciseId])).toEqual([
      [1, bench],
      [2, squat],
    ]);
    expect(exercises[0]?.targetSets).toBe(4);
    expect(exercises[0]?.targetRepsMin).toBe(6);
    expect(exercises[0]?.targetRepsMax).toBe(8);
  });

  it('produces rows P07’s builder can extend — a template, not a special case', async () => {
    // The task's stated risk: a separate, incompatible data path for
    // onboarding would mean a coach's first program can't be opened by the
    // real builder without a migration.
    const coachProfileId = await insertCoach();

    const { id } = await createProgram(db, coachProfileId, {
      name: 'Foundation',
      days: [{ name: 'Full body', exercises: [] }],
    });

    const { program } = await readProgram(id);
    expect(program?.isTemplate).toBe(true);
    expect(program?.version).toBe(1);
    expect(program?.archivedAt).toBeNull();
    // Adding week 2 is a plain insert against the same program — no
    // migration, no shape change.
    await db.insert(schema.programWeeks).values({ programId: id, weekNumber: 2 });
    const { weeks } = await readProgram(id);
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2]);
  });

  it('accepts a program whose days are all empty', async () => {
    const coachProfileId = await insertCoach();

    const { id } = await createProgram(db, coachProfileId, {
      name: 'Skeleton',
      days: [
        { name: 'Day 1', exercises: [] },
        { name: 'Day 2', exercises: [] },
        { name: 'Day 3', exercises: [] },
      ],
    });

    const { days } = await readProgram(id);
    expect(days).toHaveLength(3);
  });

  it('leaves nothing behind when one exercise id does not exist', async () => {
    // The `program_exercises.exercise_id` FK is RESTRICT, so a bad id fails
    // the insert — and the transaction is what keeps that from leaving an
    // orphan program and week for the coach to find.
    const coachProfileId = await insertCoach();

    await expect(
      createProgram(db, coachProfileId, {
        name: 'Doomed',
        days: [
          {
            name: 'Day 1',
            exercises: [
              {
                exerciseId: '00000000-0000-0000-0000-000000000000',
                targetSets: 3,
                targetRepsMin: 8,
                targetRepsMax: 12,
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();

    const programs = await db
      .select()
      .from(schema.programs)
      .where(eq(schema.programs.coachId, coachProfileId));
    expect(programs).toHaveLength(0);
  });
});
