// Real Postgres (`testing` skill §4). `programs.version` is a change
// counter maintained by application code inside the same transaction as
// each structural edit (`./program-version.ts`, `./versioning.md`,
// `assignment/00`) — there is no trigger to fall back on, so the only real
// proof this works is watching the column change (or not) after an actual
// write against a real database.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type {
  archiveProgram as ArchiveProgram,
  unarchiveProgram as UnarchiveProgram,
} from './archive-program.ts';
import type { createProgramDay as CreateProgramDay } from './create-program-day.ts';
import type { createProgramExercise as CreateProgramExercise } from './create-program-exercise.ts';
import type { createProgramWeek as CreateProgramWeek } from './create-program-week.ts';
import type { deleteProgramDay as DeleteProgramDay } from './delete-program-day.ts';
import type { deleteProgramExercise as DeleteProgramExercise } from './delete-program-exercise.ts';
import type { deleteProgramWeek as DeleteProgramWeek } from './delete-program-week.ts';
import type { duplicateProgramDay as DuplicateProgramDay } from './duplicate-program-day.ts';
import type { duplicateProgramWeek as DuplicateProgramWeek } from './duplicate-program-week.ts';
import type { reorderProgramExercises as ReorderProgramExercises } from './reorder-program-exercises.ts';
import type { setAlternatives as SetAlternatives } from './set-alternatives.ts';
import type { setSupersetGroup as SetSupersetGroup } from './set-superset-group.ts';
import type { updateProgramDay as UpdateProgramDay } from './update-program-day.ts';
import type { updateProgramExercise as UpdateProgramExercise } from './update-program-exercise.ts';
import type { updateProgram as UpdateProgram } from './update-program.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let createProgramWeek: typeof CreateProgramWeek;
let deleteProgramWeek: typeof DeleteProgramWeek;
let duplicateProgramWeek: typeof DuplicateProgramWeek;
let createProgramDay: typeof CreateProgramDay;
let updateProgramDay: typeof UpdateProgramDay;
let deleteProgramDay: typeof DeleteProgramDay;
let duplicateProgramDay: typeof DuplicateProgramDay;
let createProgramExercise: typeof CreateProgramExercise;
let updateProgramExercise: typeof UpdateProgramExercise;
let deleteProgramExercise: typeof DeleteProgramExercise;
let reorderProgramExercises: typeof ReorderProgramExercises;
let setSupersetGroup: typeof SetSupersetGroup;
let setAlternatives: typeof SetAlternatives;
let updateProgram: typeof UpdateProgram;
let archiveProgram: typeof ArchiveProgram;
let unarchiveProgram: typeof UnarchiveProgram;

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
  ({ createProgramWeek } = await import('./create-program-week.ts'));
  ({ deleteProgramWeek } = await import('./delete-program-week.ts'));
  ({ duplicateProgramWeek } = await import('./duplicate-program-week.ts'));
  ({ createProgramDay } = await import('./create-program-day.ts'));
  ({ updateProgramDay } = await import('./update-program-day.ts'));
  ({ deleteProgramDay } = await import('./delete-program-day.ts'));
  ({ duplicateProgramDay } = await import('./duplicate-program-day.ts'));
  ({ createProgramExercise } = await import('./create-program-exercise.ts'));
  ({ updateProgramExercise } = await import('./update-program-exercise.ts'));
  ({ deleteProgramExercise } = await import('./delete-program-exercise.ts'));
  ({ reorderProgramExercises } = await import('./reorder-program-exercises.ts'));
  ({ setSupersetGroup } = await import('./set-superset-group.ts'));
  ({ setAlternatives } = await import('./set-alternatives.ts'));
  ({ updateProgram } = await import('./update-program.ts'));
  ({ archiveProgram, unarchiveProgram } = await import('./archive-program.ts'));
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

interface Scene {
  coachProfileId: string;
  programId: string;
  programWeekId: string;
  programDayId: string;
  exerciseId: string;
  exerciseId2: string;
}

async function seedScene(): Promise<Scene> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@program-version-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Coach ${seq}`,
      role: 'coach',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed insert into users did not return a row');

  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning({ id: schema.coachProfiles.id });
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');

  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: profile.id, name: `Program ${seq}`, durationWeeks: 4 })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

  const [week] = await db
    .insert(schema.programWeeks)
    .values({ programId: program.id, weekNumber: 1 })
    .returning({ id: schema.programWeeks.id });
  if (!week) throw new Error('seed insert into program_weeks did not return a row');

  const [day] = await db
    .insert(schema.programDays)
    .values({ programWeekId: week.id, dayNumber: 1, name: 'Day 1' })
    .returning({ id: schema.programDays.id });
  if (!day) throw new Error('seed insert into program_days did not return a row');

  const exercises = await db
    .insert(schema.exercises)
    .values([
      {
        name: `Barbell Back Squat ${seq}`,
        primaryMuscle: 'quads',
        equipment: 'barbell',
        movementPattern: 'squat',
      },
      {
        name: `Romanian Deadlift ${seq}`,
        primaryMuscle: 'hamstrings',
        equipment: 'barbell',
        movementPattern: 'hinge',
      },
    ])
    .returning({ id: schema.exercises.id });
  const [exercise, exercise2] = exercises;
  if (!exercise || !exercise2)
    throw new Error('seed insert into exercises did not return two rows');

  return {
    coachProfileId: profile.id,
    programId: program.id,
    programWeekId: week.id,
    programDayId: day.id,
    exerciseId: exercise.id,
    exerciseId2: exercise2.id,
  };
}

async function versionOf(programId: string): Promise<number> {
  const [row] = await db
    .select({ version: schema.programs.version })
    .from(schema.programs)
    .where(eq(schema.programs.id, programId))
    .limit(1);
  if (!row) throw new Error(`no program row for ${programId}`);
  return row.version;
}

const minimalTargets = { targetSets: 3 } as const;

describe('program version — structural edits bump programs.version by exactly one', () => {
  it('createProgramWeek', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await createProgramWeek(db, { programId: scene.programId, weekNumber: 2 });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('deleteProgramWeek', async () => {
    const scene = await seedScene();
    const { id: weekId } = await createProgramWeek(db, {
      programId: scene.programId,
      weekNumber: 2,
    });
    const before = await versionOf(scene.programId);

    await deleteProgramWeek(db, weekId);

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('duplicateProgramWeek', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await duplicateProgramWeek(db, { sourceWeekId: scene.programWeekId });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('createProgramDay', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await createProgramDay(db, { programWeekId: scene.programWeekId, dayNumber: 2, name: 'Day 2' });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('updateProgramDay — including a purely cosmetic-looking field like notes', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await updateProgramDay(db, { programDayId: scene.programDayId, notes: 'Deload this week' });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('deleteProgramDay', async () => {
    const scene = await seedScene();
    const { id: dayId } = await createProgramDay(db, {
      programWeekId: scene.programWeekId,
      dayNumber: 2,
      name: 'Day 2',
    });
    const before = await versionOf(scene.programId);

    await deleteProgramDay(db, dayId);

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('duplicateProgramDay', async () => {
    const scene = await seedScene();
    const { id: targetWeekId } = await createProgramWeek(db, {
      programId: scene.programId,
      weekNumber: 2,
    });
    const before = await versionOf(scene.programId);

    await duplicateProgramDay(db, {
      sourceDayId: scene.programDayId,
      targetWeekId,
      targetDayNumber: 1,
    });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('createProgramExercise', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('updateProgramExercise', async () => {
    const scene = await seedScene();
    const { id: blockId } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });
    const before = await versionOf(scene.programId);

    await updateProgramExercise(db, { programExerciseId: blockId, targetSets: 5 });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('deleteProgramExercise', async () => {
    const scene = await seedScene();
    const { id: blockId } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });
    const before = await versionOf(scene.programId);

    await deleteProgramExercise(db, blockId);

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('reorderProgramExercises', async () => {
    const scene = await seedScene();
    const { id: block1 } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });
    const { id: block2 } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId2,
      ...minimalTargets,
    });
    const before = await versionOf(scene.programId);

    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [block2, block1],
    });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('setSupersetGroup', async () => {
    const scene = await seedScene();
    const { id: block1 } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });
    const { id: block2 } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId2,
      ...minimalTargets,
    });
    const before = await versionOf(scene.programId);

    await setSupersetGroup(db, {
      programDayId: scene.programDayId,
      exerciseIds: [block1, block2],
      group: 'A',
    });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });

  it('setAlternatives', async () => {
    const scene = await seedScene();
    const { id: blockId } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });
    const before = await versionOf(scene.programId);

    await setAlternatives(db, scene.coachProfileId, {
      programExerciseId: blockId,
      alternativeExerciseIds: [scene.exerciseId2],
    });

    expect(await versionOf(scene.programId)).toBe(before + 1);
  });
});

describe('program version — cosmetic edits never touch programs.version', () => {
  it('updateProgram: name, description, durationWeeks, isTemplate', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await updateProgram(db, {
      programId: scene.programId,
      name: 'Renamed program',
      description: 'A new description',
      durationWeeks: 8,
      isTemplate: false,
    });

    expect(await versionOf(scene.programId)).toBe(before);
  });

  it('archiveProgram / unarchiveProgram', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await archiveProgram(db, scene.programId);
    await unarchiveProgram(db, scene.programId);

    expect(await versionOf(scene.programId)).toBe(before);
  });
});

describe('program version — the counter never drifts from the edit it counts', () => {
  it('a refused createProgramWeek (duplicate week number) does not bump version', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await expect(
      createProgramWeek(db, { programId: scene.programId, weekNumber: 1 }),
    ).rejects.toBeDefined();

    // The failed insert and a version bump would have to disagree for this
    // to fail — proof the increment lives inside the same transaction as
    // the write it counts, not a second one that could commit alone.
    expect(await versionOf(scene.programId)).toBe(before);
  });

  it('accumulates across multiple structural edits, one per edit', async () => {
    const scene = await seedScene();
    const before = await versionOf(scene.programId);

    await createProgramWeek(db, { programId: scene.programId, weekNumber: 2 });
    const { id: dayId } = await createProgramDay(db, {
      programWeekId: scene.programWeekId,
      dayNumber: 2,
      name: 'Day 2',
    });
    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: dayId,
      exerciseId: scene.exerciseId,
      ...minimalTargets,
    });

    expect(await versionOf(scene.programId)).toBe(before + 3);
  });
});
