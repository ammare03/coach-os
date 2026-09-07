// Real Postgres (`testing` skill §4). Two things here can only be proved
// against a real database: that a target block written by
// `createProgramExercise` survives the round trip through `numeric(_,1)`
// unchanged, and that DB§5.2's `CHECK`s are still standing behind the Zod
// schema — the backstop `program-builder/02`'s Verification asks for, under
// a client that has been patched or has simply gone stale.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { asc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { isCatalogedError } from '../../lib/app-error.ts';

import type { createProgramExercise as CreateProgramExercise } from './create-program-exercise.ts';
import type { deleteProgramExercise as DeleteProgramExercise } from './delete-program-exercise.ts';
import type { getProgramDay as GetProgramDay } from './get-program-day.ts';
import type { updateProgramExercise as UpdateProgramExercise } from './update-program-exercise.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let createProgramExercise: typeof CreateProgramExercise;
let updateProgramExercise: typeof UpdateProgramExercise;
let deleteProgramExercise: typeof DeleteProgramExercise;
let getProgramDay: typeof GetProgramDay;

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
  ({ createProgramExercise } = await import('./create-program-exercise.ts'));
  ({ updateProgramExercise } = await import('./update-program-exercise.ts'));
  ({ deleteProgramExercise } = await import('./delete-program-exercise.ts'));
  ({ getProgramDay } = await import('./get-program-day.ts'));
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

interface Scene {
  coachProfileId: string;
  programDayId: string;
  restDayId: string;
  exerciseId: string;
}

async function seedScene(): Promise<Scene> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@program-exercises-test.com`,
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

  const days = await db
    .insert(schema.programDays)
    .values([
      { programWeekId: week.id, dayNumber: 2, name: 'Lower — squat focus' },
      { programWeekId: week.id, dayNumber: 3, name: 'Rest', isRestDay: true },
    ])
    .returning({ id: schema.programDays.id });
  const [day, restDay] = days;
  if (!day || !restDay) throw new Error('seed insert into program_days did not return two rows');

  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Barbell Back Squat ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');

  return {
    coachProfileId: profile.id,
    programDayId: day.id,
    restDayId: restDay.id,
    exerciseId: exercise.id,
  };
}

function appCodeOf(error: unknown): string | null {
  return isCatalogedError(error) ? error.cause.appCode : null;
}

/**
 * The constraint a write actually tripped. Drizzle's own message names the
 * query, never the constraint — the driver error two layers under it is
 * where the name lives (`../../db/is-database-error.ts`), so asserting on
 * the message would silently pass for the wrong reason.
 */
async function constraintViolatedBy(write: Promise<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return unwrapDatabaseError(error)?.constraint_name;
  }
  throw new Error('expected the write to be refused, and it was not');
}

async function rowsOfDay(programDayId: string) {
  return db
    .select()
    .from(schema.programExercises)
    .where(eq(schema.programExercises.programDayId, programDayId))
    .orderBy(asc(schema.programExercises.orderIndex));
}

describe('createProgramExercise', () => {
  it('persists the whole target block, including both numeric(_,1) columns', async () => {
    const scene = await seedScene();

    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 7.5,
      tempo: '3010',
      targetRestSeconds: 90,
      coachNotes: 'Top set first, then two back-offs at the same load.',
    });

    const [row] = await rowsOfDay(scene.programDayId);
    expect(row).toMatchObject({
      orderIndex: 1,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      // `numeric` crosses Drizzle as a string, at the column's own scale.
      targetRpe: '7.5',
      targetRir: null,
      targetPercent1rm: null,
      tempo: '3010',
      targetRestSeconds: 90,
    });
  });

  it('appends past the day’s current last block rather than taking a position from the caller', async () => {
    const scene = await seedScene();

    for (const sets of [3, 4, 5]) {
      await createProgramExercise(db, scene.coachProfileId, {
        programDayId: scene.programDayId,
        exerciseId: scene.exerciseId,
        targetSets: sets,
      });
    }

    const rows = await rowsOfDay(scene.programDayId);
    expect(rows.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.targetSets)).toEqual([3, 4, 5]);
  });

  it('refuses an exercise the coach cannot see, with the same code exercises.get gives', async () => {
    const scene = await seedScene();
    const other = await seedScene();
    // Another coach's custom exercise: real row, invisible to this caller.
    const [foreign] = await db
      .insert(schema.exercises)
      .values({
        coachId: other.coachProfileId,
        name: `Foreign Movement ${seq}`,
        primaryMuscle: 'quads',
        equipment: 'barbell',
        movementPattern: 'squat',
      })
      .returning({ id: schema.exercises.id });
    if (!foreign) throw new Error('seed insert into exercises did not return a row');

    await expect(
      createProgramExercise(db, scene.coachProfileId, {
        programDayId: scene.programDayId,
        exerciseId: foreign.id,
        targetSets: 3,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'EXERCISE_NOT_FOUND' } });

    expect(await rowsOfDay(scene.programDayId)).toHaveLength(0);
  });

  it('refuses the thirty-first block on a day', async () => {
    const scene = await seedScene();
    await db.insert(schema.programExercises).values(
      Array.from({ length: 30 }, (_, index) => ({
        programDayId: scene.programDayId,
        exerciseId: scene.exerciseId,
        orderIndex: index + 1,
        targetSets: 3,
      })),
    );

    const error = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 3,
    }).catch((caught: unknown) => caught);

    expect(appCodeOf(error)).toBe('PROGRAM_EXERCISE_LIMIT_REACHED');
    expect(await rowsOfDay(scene.programDayId)).toHaveLength(30);
  });
});

describe('updateProgramExercise', () => {
  it('replaces the whole block — an omitted field is a cleared one', async () => {
    const scene = await seedScene();
    const { id } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8,
      tempo: '3010',
      targetRestSeconds: 90,
      coachNotes: 'Push the top set.',
    });

    await updateProgramExercise(db, {
      programExerciseId: id,
      targetSets: 3,
      targetRepsMin: 10,
      targetRepsMax: 12,
      targetPercent1rm: 65,
      targetRestSeconds: 60,
    });

    const [row] = await rowsOfDay(scene.programDayId);
    expect(row).toMatchObject({
      targetSets: 3,
      targetRepsMin: 10,
      targetRepsMax: 12,
      targetRpe: null,
      targetPercent1rm: '65.0',
      tempo: null,
      targetRestSeconds: 60,
      coachNotes: null,
    });
  });

  it('leaves the fields tasks 03, 04 and 05 own alone', async () => {
    const scene = await seedScene();
    const { id } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 4,
    });
    await db
      .update(schema.programExercises)
      .set({ supersetGroup: 'A', alternatives: [scene.exerciseId] })
      .where(eq(schema.programExercises.id, id));

    await updateProgramExercise(db, { programExerciseId: id, targetSets: 5 });

    const [row] = await rowsOfDay(scene.programDayId);
    expect(row).toMatchObject({
      targetSets: 5,
      orderIndex: 1,
      supersetGroup: 'A',
      alternatives: [scene.exerciseId],
      exerciseId: scene.exerciseId,
    });
  });
});

describe('deleteProgramExercise', () => {
  it('removes one block and leaves its siblings where the coach put them', async () => {
    const scene = await seedScene();
    const created = [];
    for (const sets of [3, 4, 5]) {
      created.push(
        await createProgramExercise(db, scene.coachProfileId, {
          programDayId: scene.programDayId,
          exerciseId: scene.exerciseId,
          targetSets: sets,
        }),
      );
    }
    const second = created[1];
    if (!second) throw new Error('expected three created blocks');

    await deleteProgramExercise(db, second.id);

    const rows = await rowsOfDay(scene.programDayId);
    expect(rows.map((row) => row.orderIndex)).toEqual([1, 3]);

    // The gap must not collide with the next add.
    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 6,
    });
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.orderIndex)).toEqual([1, 3, 4]);
  });
});

describe('getProgramDay', () => {
  it('returns the day, its week, its sibling slots and its blocks in order', async () => {
    const scene = await seedScene();
    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 7.5,
      tempo: '3010',
      targetRestSeconds: 90,
    });
    await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.programDayId,
      exerciseId: scene.exerciseId,
      targetSets: 3,
      targetPercent1rm: 65,
    });

    const day = await getProgramDay(db, scene.programDayId);

    expect(day).toMatchObject({ dayNumber: 2, weekNumber: 1, name: 'Lower — squat focus' });
    expect(day?.siblingDays.map((slot) => slot.dayNumber)).toEqual([2, 3]);
    // Parsed once, at this boundary — a screen never sees the string.
    expect(day?.exercises.map((block) => block.targetRpe)).toEqual([7.5, null]);
    expect(day?.exercises.map((block) => block.targetPercent1rm)).toEqual([null, 65]);
    expect(day?.exercises.map((block) => block.orderIndex)).toEqual([1, 2]);
    expect(day?.exercises[0]?.exerciseName).toContain('Barbell Back Squat');
  });

  it('is null for an id that names nothing', async () => {
    expect(await getProgramDay(db, '00000000-0000-7000-8000-00000000dead')).toBeNull();
  });

  it('returns a rest day with no blocks rather than refusing to describe it', async () => {
    const scene = await seedScene();

    const day = await getProgramDay(db, scene.restDayId);

    expect(day).toMatchObject({ isRestDay: true, exercises: [] });
  });
});

// The Zod schema refuses all three of these before they leave the device
// (`packages/schemas/src/__tests__/programs.test.ts`). These assertions are
// about what happens when it does not — a patched client, a stale build, a
// future caller that forgets. DB§5.2's `CHECK`s are the floor, and a floor
// nobody tests is a floor nobody knows is there.
describe('DB§5.2 constraints — the backstop under the schema', () => {
  it('refuses a rep top below its bottom', async () => {
    const scene = await seedScene();

    expect(
      await constraintViolatedBy(
        db.insert(schema.programExercises).values({
          programDayId: scene.programDayId,
          exerciseId: scene.exerciseId,
          orderIndex: 1,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 6,
        }),
      ),
    ).toBe('program_exercises_target_reps_max_check');
  });

  it('refuses an RPE above 10', async () => {
    const scene = await seedScene();

    expect(
      await constraintViolatedBy(
        db.insert(schema.programExercises).values({
          programDayId: scene.programDayId,
          exerciseId: scene.exerciseId,
          orderIndex: 1,
          targetSets: 3,
          targetRpe: '11.0',
        }),
      ),
    ).toBe('program_exercises_target_rpe_check');
  });

  it('refuses a malformed tempo', async () => {
    const scene = await seedScene();

    expect(
      await constraintViolatedBy(
        db.insert(schema.programExercises).values({
          programDayId: scene.programDayId,
          exerciseId: scene.exerciseId,
          orderIndex: 1,
          targetSets: 3,
          tempo: '3-1-0',
        }),
      ),
    ).toBe('program_exercises_tempo_check');
  });

  it('refuses more than 20 sets', async () => {
    const scene = await seedScene();

    expect(
      await constraintViolatedBy(
        db.insert(schema.programExercises).values({
          programDayId: scene.programDayId,
          exerciseId: scene.exerciseId,
          orderIndex: 1,
          targetSets: 21,
        }),
      ),
    ).toBe('program_exercises_target_sets_check');
  });
});
