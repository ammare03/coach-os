// Real Postgres (`testing` skill §4) — the filter under test is a `WHERE`
// clause, and a mocked Drizzle proves nothing about whether it is actually
// applied. `program-templates/01`'s own Verification: toggle a program's
// template status and confirm it appears/disappears from `listTemplates`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { listProgramTemplates as ListProgramTemplates } from './list-program-templates.ts';
import type { updateProgram as UpdateProgram } from './update-program.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let listProgramTemplates: typeof ListProgramTemplates;
let updateProgram: typeof UpdateProgram;

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
  ({ listProgramTemplates } = await import('./list-program-templates.ts'));
  ({ updateProgram } = await import('./update-program.ts'));
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
      email: `coach-${seq}@list-templates-test.com`,
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

async function insertExercise(): Promise<string> {
  seq += 1;
  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Exercise ${seq}`,
      primaryMuscle: 'quadriceps',
      equipment: 'Barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

/** A bare program row, with an `updated_at` this test can control directly. */
async function insertProgram(
  coachProfileId: string,
  overrides: Partial<{
    name: string;
    isTemplate: boolean;
    archivedAt: Date | null;
    updatedAt: Date;
  }> = {},
): Promise<string> {
  const [program] = await db
    .insert(schema.programs)
    .values({
      coachId: coachProfileId,
      name: overrides.name ?? 'Program',
      durationWeeks: 4,
      ...(overrides.isTemplate !== undefined ? { isTemplate: overrides.isTemplate } : {}),
      ...(overrides.archivedAt !== undefined ? { archivedAt: overrides.archivedAt } : {}),
      ...(overrides.updatedAt !== undefined ? { updatedAt: overrides.updatedAt } : {}),
    })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');
  return program.id;
}

async function addWeekWithDay(
  programId: string,
  weekNumber: number,
  days: { dayNumber: number; isRestDay?: boolean; exerciseCount?: number }[],
  exerciseId: string,
): Promise<void> {
  const [week] = await db
    .insert(schema.programWeeks)
    .values({ programId, weekNumber })
    .returning({ id: schema.programWeeks.id });
  if (!week) throw new Error('seed insert into program_weeks did not return a row');

  for (const day of days) {
    const [row] = await db
      .insert(schema.programDays)
      .values({
        programWeekId: week.id,
        dayNumber: day.dayNumber,
        name: `Day ${String(day.dayNumber)}`,
        isRestDay: day.isRestDay ?? false,
      })
      .returning({ id: schema.programDays.id });
    if (!row) throw new Error('seed insert into program_days did not return a row');

    const exerciseCount = day.exerciseCount ?? 0;
    for (let i = 0; i < exerciseCount; i += 1) {
      await db.insert(schema.programExercises).values({
        programDayId: row.id,
        exerciseId,
        orderIndex: i + 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      });
    }
  }
}

describe('listProgramTemplates', () => {
  it('returns only this coach’s templates, excluding non-templates and archived ones', async () => {
    const coachProfileId = await insertCoach();
    const other = await insertCoach();

    const template = await insertProgram(coachProfileId, { name: 'Real template' });
    await insertProgram(coachProfileId, { name: 'Not a template', isTemplate: false });
    await insertProgram(coachProfileId, { name: 'Archived', archivedAt: new Date() });
    await insertProgram(other, { name: 'Someone else’s template' });

    const result = await listProgramTemplates(db, coachProfileId, { limit: 20 });

    expect(result.items.map((i) => i.id)).toEqual([template]);
    expect(result.items[0]?.name).toBe('Real template');
    expect(result.nextCursor).toBeNull();
  });

  it('orders most-recently-updated first', async () => {
    const coachProfileId = await insertCoach();
    const oldest = await insertProgram(coachProfileId, {
      name: 'Oldest',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newest = await insertProgram(coachProfileId, {
      name: 'Newest',
      updatedAt: new Date('2026-03-01T00:00:00Z'),
    });
    const middle = await insertProgram(coachProfileId, {
      name: 'Middle',
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const result = await listProgramTemplates(db, coachProfileId, { limit: 20 });

    expect(result.items.map((i) => i.id)).toEqual([newest, middle, oldest]);
  });

  it('paginates by keyset cursor, one page at a time', async () => {
    const coachProfileId = await insertCoach();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      // Distinct timestamps, oldest first — inserted in reverse so id order
      // never accidentally matches update order.
      ids.push(
        await insertProgram(coachProfileId, {
          name: `Program ${String(i)}`,
          updatedAt: new Date(Date.UTC(2026, 0, i + 1)),
        }),
      );
    }
    const [oldest, middle, newest] = ids;

    const firstPage = await listProgramTemplates(db, coachProfileId, { limit: 2 });
    expect(firstPage.items.map((i) => i.id)).toEqual([newest, middle]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listProgramTemplates(db, coachProfileId, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items.map((i) => i.id)).toEqual([oldest]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('counts distinct non-rest days and total exercises across the whole program', async () => {
    const coachProfileId = await insertCoach();
    const exerciseId = await insertExercise();
    const programId = await insertProgram(coachProfileId, { name: 'Hypertrophy' });

    // Week 1: two training days (2 + 1 exercises) and a rest day.
    await addWeekWithDay(
      programId,
      1,
      [
        { dayNumber: 1, exerciseCount: 2 },
        { dayNumber: 2, exerciseCount: 1 },
        { dayNumber: 3, isRestDay: true },
      ],
      exerciseId,
    );
    // Week 2 repeats the same two training-day slots — the count should not double.
    await addWeekWithDay(
      programId,
      2,
      [
        { dayNumber: 1, exerciseCount: 3 },
        { dayNumber: 2, exerciseCount: 0 },
      ],
      exerciseId,
    );

    const result = await listProgramTemplates(db, coachProfileId, { limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.daysPerWeek).toBe(2);
    expect(result.items[0]?.exerciseCount).toBe(6);
  });

  it('disappears from the list once toggled off, per programs.update', async () => {
    const coachProfileId = await insertCoach();
    const programId = await insertProgram(coachProfileId, { name: 'Toggle me' });

    expect((await listProgramTemplates(db, coachProfileId, { limit: 20 })).items).toHaveLength(1);

    await updateProgram(db, { programId, isTemplate: false });

    expect((await listProgramTemplates(db, coachProfileId, { limit: 20 })).items).toHaveLength(0);

    await updateProgram(db, { programId, isTemplate: true });

    expect((await listProgramTemplates(db, coachProfileId, { limit: 20 })).items).toHaveLength(1);
  });

  it('leaves other fields untouched when only isTemplate changes', async () => {
    const coachProfileId = await insertCoach();
    const programId = await insertProgram(coachProfileId, { name: 'Untouched' });

    await updateProgram(db, { programId, isTemplate: false });

    const [row] = await db.select().from(schema.programs).where(eq(schema.programs.id, programId));
    expect(row?.name).toBe('Untouched');
    expect(row?.isTemplate).toBe(false);
  });
});
