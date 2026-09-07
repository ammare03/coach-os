// Real Postgres (`testing` skill §4). Two things here can only be proved
// against a real database: that a target block written by
// `createProgramExercise` survives the round trip through `numeric(_,1)`
// unchanged, and that DB§5.2's `CHECK`s are still standing behind the Zod
// schema — the backstop `program-builder/02`'s Verification asks for, under
// a client that has been patched or has simply gone stale.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { asc, eq, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { isCatalogedError } from '../../lib/app-error.ts';

import type { createProgramExercise as CreateProgramExercise } from './create-program-exercise.ts';
import type { deleteProgramExercise as DeleteProgramExercise } from './delete-program-exercise.ts';
import type { getProgramDay as GetProgramDay } from './get-program-day.ts';
import type { reorderProgramExercises as ReorderProgramExercises } from './reorder-program-exercises.ts';
import type { updateProgramExercise as UpdateProgramExercise } from './update-program-exercise.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let createProgramExercise: typeof CreateProgramExercise;
let updateProgramExercise: typeof UpdateProgramExercise;
let deleteProgramExercise: typeof DeleteProgramExercise;
let getProgramDay: typeof GetProgramDay;
let reorderProgramExercises: typeof ReorderProgramExercises;

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
  ({ reorderProgramExercises } = await import('./reorder-program-exercises.ts'));
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

describe('reorderProgramExercises', () => {
  /** N blocks on one day, returned in the order they were created. */
  async function seedBlocks(scene: Scene, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const { id } = await createProgramExercise(db, scene.coachProfileId, {
        programDayId: scene.programDayId,
        exerciseId: scene.exerciseId,
        // A distinguishable value per block, so a test asserting on order is
        // asserting on identity and not on position alone.
        targetSets: index + 1,
      });
      ids.push(id);
    }
    return ids;
  }

  // The whole point of this task's Approach §2, and the case a
  // non-overlapping reorder never reaches: PostgreSQL checks a plain unique
  // index per row as each row is written, so any new order that reuses a
  // position another row has not yet vacated trips
  // `program_exercises_program_day_id_order_index_unique` unless the write
  // parks the rows out of the way first.
  it('moves the last block to first — every target position is still occupied when it is assigned', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 5);
    const last = ids[4];
    if (!last) throw new Error('expected five seeded blocks');
    const newOrder = [last, ...ids.slice(0, 4)];

    const result = await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: newOrder,
    });

    const rows = await rowsOfDay(scene.programDayId);
    expect(rows.map((row) => row.orderIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.id)).toEqual(newOrder);
    // The block's own payload travelled with it — this is a reorder, not a
    // rewrite of five rows' contents.
    expect(rows.map((row) => row.targetSets)).toEqual([5, 1, 2, 3, 4]);
    expect(result.exercises).toEqual(
      newOrder.map((id, position) => ({ id, orderIndex: position + 1 })),
    );
  });

  // The premise the two-statement write exists for, proved rather than
  // asserted: the obvious single `UPDATE ... SET order_index = CASE id ...`
  // that assigns the finals directly DOES trip the unique index on an
  // overlapping permutation. If PostgreSQL ever stops checking a plain
  // unique index per row, this test fails and
  // `reorder-program-exercises.ts` can be simplified to one statement.
  it('confirms a direct single-statement renumber is refused by the unique index', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 3);
    const [first, second, third] = ids;
    if (!first || !second || !third) throw new Error('expected three seeded blocks');

    const naive = db
      .update(schema.programExercises)
      .set({
        orderIndex: sql`case ${schema.programExercises.id}
          when ${third}::uuid then 1::smallint
          when ${first}::uuid then 2::smallint
          when ${second}::uuid then 3::smallint end`,
      })
      .where(eq(schema.programExercises.programDayId, scene.programDayId));

    expect(await constraintViolatedBy(naive)).toBe(
      'program_exercises_program_day_id_order_index_unique',
    );

    // …and the real path takes exactly the same reorder without complaint.
    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [third, first, second],
    });
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.id)).toEqual([
      third,
      first,
      second,
    ]);
  });

  it('reverses a day outright — every row lands on a position another row held', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 6);
    const reversed = [...ids].reverse();

    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: reversed,
    });

    const rows = await rowsOfDay(scene.programDayId);
    expect(rows.map((row) => row.orderIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((row) => row.id)).toEqual(reversed);
  });

  // A pair swap is the smallest overlapping permutation there is, and the
  // one a naive sequential update fails on first.
  it('swaps two adjacent blocks', async () => {
    const scene = await seedScene();
    const [first, second, third] = await seedBlocks(scene, 3);
    if (!first || !second || !third) throw new Error('expected three seeded blocks');

    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [second, first, third],
    });

    expect((await rowsOfDay(scene.programDayId)).map((row) => row.id)).toEqual([
      second,
      first,
      third,
    ]);
  });

  // `deleteProgramExercise` leaves gaps on purpose (its own docblock), so a
  // real day's indices are not always 1..N going in.
  it('closes the gaps a delete left', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 4);
    const [first, second, third, fourth] = ids;
    if (!first || !second || !third || !fourth) throw new Error('expected four seeded blocks');
    await deleteProgramExercise(db, second);
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.orderIndex)).toEqual([1, 3, 4]);

    const remaining = [fourth, first, third];
    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: remaining,
    });

    const rows = await rowsOfDay(scene.programDayId);
    expect(rows.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.id)).toEqual(remaining);
  });

  it('is a no-op when the order has not changed', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 3);

    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: ids,
    });

    expect((await rowsOfDay(scene.programDayId)).map((row) => row.id)).toEqual(ids);
  });

  it('refuses a partial list rather than silently dropping the blocks it omits', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 4);

    const error = await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: ids.slice(0, 3),
    }).catch((caught: unknown) => caught);

    expect(appCodeOf(error)).toBe('PROGRAM_DAY_ORDER_STALE');
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.orderIndex)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  // `ownsResource('programExercise', …)` refuses another COACH's id before
  // this function runs. This is the case ownership cannot see: a block this
  // same coach owns, sitting on a different day of their own program.
  it('refuses an id from one of the coach’s own other days', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 2);
    const { id: otherDayBlock } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.restDayId,
      exerciseId: scene.exerciseId,
      targetSets: 3,
    });

    const error = await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [otherDayBlock, ...ids],
    }).catch((caught: unknown) => caught);

    expect(appCodeOf(error)).toBe('PROGRAM_DAY_ORDER_STALE');
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.id)).toEqual(ids);
    expect((await rowsOfDay(scene.restDayId)).map((row) => row.orderIndex)).toEqual([1]);
  });

  // Zod refuses this before it leaves the device; this is the floor under a
  // patched client, and it matters because a duplicated id makes the list
  // the right LENGTH while still not being a permutation.
  it('refuses a list that names the same block twice', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 2);
    const first = ids[0];
    if (!first) throw new Error('expected two seeded blocks');

    const error = await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [first, first],
    }).catch((caught: unknown) => caught);

    expect(appCodeOf(error)).toBe('PROGRAM_DAY_ORDER_STALE');
    expect((await rowsOfDay(scene.programDayId)).map((row) => row.id)).toEqual(ids);
  });

  it('leaves another day of the same program untouched', async () => {
    const scene = await seedScene();
    const ids = await seedBlocks(scene, 3);
    const { id: otherDayBlock } = await createProgramExercise(db, scene.coachProfileId, {
      programDayId: scene.restDayId,
      exerciseId: scene.exerciseId,
      targetSets: 3,
    });

    await reorderProgramExercises(db, {
      programDayId: scene.programDayId,
      orderedExerciseIds: [...ids].reverse(),
    });

    expect((await rowsOfDay(scene.restDayId)).map((row) => row.id)).toEqual([otherDayBlock]);
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
