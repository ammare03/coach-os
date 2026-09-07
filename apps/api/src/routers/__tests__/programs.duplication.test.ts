// Real Postgres (`testing` skill §4). `program-builder/06`'s Verification,
// performed: duplicate a day carrying a superset, approved swaps and a
// target weight and confirm the copy preserves all of it with fresh ids;
// then the same for a whole week. None of that can be tested against a
// mock — the fidelity claim is about what Postgres actually holds after the
// write, the id-collision claim is about the `uuidv7` column default, and
// the atomicity claim is about a transaction boundary.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient, type ProgramExercise } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { carriedExerciseColumns, copyDaysInto } from '../../features/programs/copy-program-days.ts';
import { isCatalogedError } from '../../lib/app-error.ts';
import type { Context, ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;

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
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

let seq = 0;

interface Coach {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<Coach> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@programs-duplication-test.com`,
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

  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: 'coach',
    timezone: user.timezone,
    locale: user.locale,
    isMinor: user.isMinor,
    guardianConsentAt: user.guardianConsentAt,
    coachProfileId: profile.id,
    clientProfileId: null,
    deletedAt: null,
  };
  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

function caller(coach: Coach) {
  return appRouter.createCaller(coach.ctx);
}

/** The catalogued `cause.appCode` of a rejected call — never its message. */
async function appCodeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCError && isCatalogedError(error)) return error.cause.appCode;
    throw error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

async function insertExercise(name: string): Promise<string> {
  seq += 1;
  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `${name} ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

interface Scene {
  coach: Coach;
  programId: string;
  /** Week 1, holding `dayId` (Tuesday, three blocks) and `restDayId` (Wednesday). */
  weekId: string;
  dayId: string;
  restDayId: string;
  /** The block carrying the approved swaps and the absolute target weight. */
  swapExerciseIds: string[];
}

/**
 * One day carrying every kind of value a copy has to preserve: a superset
 * spanning two consecutive blocks, a third block with an absolute target
 * weight and three coach-approved alternatives, tempo, rest, and coach
 * notes. Anything a copy drops shows up here.
 */
async function seedScene(): Promise<Scene> {
  const coach = await insertCoach();
  const { id: programId } = await caller(coach).programs.create({
    name: 'Hypertrophy block',
    durationWeeks: 4,
  });
  const program = await caller(coach).programs.get({ programId });
  const weekId = program.weeks[0]?.id;
  if (!weekId) throw new Error('expected week 1 to exist');

  const day = await caller(coach).programs.days.create({
    programWeekId: weekId,
    dayNumber: 2,
    name: 'Lower — squat focus',
    notes: 'Push the top set, leave the back-offs alone.',
  });
  const restDay = await caller(coach).programs.days.create({
    programWeekId: weekId,
    dayNumber: 3,
    name: 'Rest',
    isRestDay: true,
  });

  const squatId = await insertExercise('Barbell Back Squat');
  const legCurlId = await insertExercise('Lying Leg Curl');
  const pressId = await insertExercise('Leg Press');
  const hackId = await insertExercise('Hack Squat');
  const gobletId = await insertExercise('Goblet Squat');

  const first = await caller(coach).programs.exercises.create({
    programDayId: day.id,
    exerciseId: squatId,
    targetSets: 4,
    targetRepsMin: 6,
    targetRepsMax: 8,
    targetRpe: 7.5,
    tempo: '3010',
    targetRestSeconds: 150,
    coachNotes: 'Top set first, then two back-offs at the same load.',
  });
  const second = await caller(coach).programs.exercises.create({
    programDayId: day.id,
    exerciseId: legCurlId,
    targetSets: 3,
    targetRepsMin: 10,
    targetRepsMax: 12,
    targetRir: 2,
  });
  const third = await caller(coach).programs.exercises.create({
    programDayId: day.id,
    exerciseId: pressId,
    targetSets: 3,
    targetRepsMin: 5,
    targetRepsMax: 5,
    // Kilograms, at `numeric(6, 2)`'s own scale (DB§5.1.1).
    targetWeightKg: 102.5,
    tempo: '20X0',
  });

  await caller(coach).programs.exercises.setSupersetGroup({
    programDayId: day.id,
    exerciseIds: [first.id, second.id],
    group: 'A',
  });
  const swapExerciseIds = [hackId, gobletId, squatId];
  await caller(coach).programs.exercises.setAlternatives({
    programExerciseId: third.id,
    alternativeExerciseIds: swapExerciseIds,
  });

  return { coach, programId, weekId, dayId: day.id, restDayId: restDay.id, swapExerciseIds };
}

async function blocksOf(programDayId: string): Promise<ProgramExercise[]> {
  return db
    .select()
    .from(schema.programExercises)
    .where(eq(schema.programExercises.programDayId, programDayId))
    .orderBy(asc(schema.programExercises.orderIndex));
}

/**
 * Everything about a block except its identity, its parent, and its audit
 * stamps — the production omission itself, so the assertion cannot silently
 * stop covering a column the copy stopped carrying.
 */
const carried = carriedExerciseColumns;

async function daysOf(programWeekId: string) {
  return db
    .select()
    .from(schema.programDays)
    .where(eq(schema.programDays.programWeekId, programWeekId))
    .orderBy(asc(schema.programDays.dayNumber));
}

describe('programs.days.duplicate', () => {
  it('copies a day carrying a superset, approved swaps and a target weight — every value, fresh ids', async () => {
    const scene = await seedScene();

    const copy = await caller(scene.coach).programs.days.duplicate({
      sourceDayId: scene.dayId,
      targetWeekId: scene.weekId,
      targetDayNumber: 5,
    });

    expect(copy.id).not.toBe(scene.dayId);

    const [copiedDay] = await db
      .select()
      .from(schema.programDays)
      .where(eq(schema.programDays.id, copy.id));
    expect(copiedDay).toMatchObject({
      programWeekId: scene.weekId,
      dayNumber: 5,
      name: 'Lower — squat focus',
      notes: 'Push the top set, leave the back-offs alone.',
      isRestDay: false,
    });

    const source = await blocksOf(scene.dayId);
    const copied = await blocksOf(copy.id);

    // The whole claim in one assertion: every column but identity, parent
    // and audit stamps is byte-identical, in the same order.
    expect(copied.map(carried)).toEqual(source.map(carried));

    // …and spelled out for the three the task names, so a regression says
    // which one it broke rather than dumping two arrays.
    expect(copied.map((block) => block.supersetGroup)).toEqual(['A', 'A', null]);
    expect(copied[2]?.alternatives).toEqual(scene.swapExerciseIds);
    expect(copied[2]?.targetWeightKg).toBe('102.50');
    expect(copied.map((block) => block.orderIndex)).toEqual(
      source.map((block) => block.orderIndex),
    );

    // No id collision with the source, at either level.
    const sourceIds = new Set(source.map((block) => block.id));
    expect(copied.filter((block) => sourceIds.has(block.id))).toEqual([]);
  });

  it('copies a rest day as a rest day, with nothing beneath it', async () => {
    const scene = await seedScene();

    const copy = await caller(scene.coach).programs.days.duplicate({
      sourceDayId: scene.restDayId,
      targetWeekId: scene.weekId,
      targetDayNumber: 6,
    });

    const [copiedDay] = await db
      .select()
      .from(schema.programDays)
      .where(eq(schema.programDays.id, copy.id));
    expect(copiedDay).toMatchObject({ dayNumber: 6, name: 'Rest', isRestDay: true });
    expect(await blocksOf(copy.id)).toEqual([]);
  });

  it('refuses a taken slot with PROGRAM_DAY_TAKEN, before writing anything', async () => {
    const scene = await seedScene();

    const code = await appCodeOf(
      caller(scene.coach).programs.days.duplicate({
        sourceDayId: scene.dayId,
        targetWeekId: scene.weekId,
        // Wednesday already holds the rest day.
        targetDayNumber: 3,
      }),
    );
    expect(code).toBe('PROGRAM_DAY_TAKEN');

    // Nothing landed: the week still holds exactly the two seeded days, and
    // the rest day still has no blocks under it.
    expect((await daysOf(scene.weekId)).map((day) => day.dayNumber)).toEqual([2, 3]);
    expect(await blocksOf(scene.restDayId)).toEqual([]);
  });

  it('refuses a target week in a DIFFERENT program with PROGRAM_COPY_CROSS_PROGRAM', async () => {
    const scene = await seedScene();
    // A second program owned by the SAME coach, so both `ownsResource`
    // guards pass and only the resolver's own check can refuse it.
    const other = await caller(scene.coach).programs.create({ name: 'Other program' });
    const otherProgram = await caller(scene.coach).programs.get({ programId: other.id });
    const otherWeekId = otherProgram.weeks[0]?.id;
    if (!otherWeekId) throw new Error('expected the other program to have week 1');

    const code = await appCodeOf(
      caller(scene.coach).programs.days.duplicate({
        sourceDayId: scene.dayId,
        targetWeekId: otherWeekId,
        targetDayNumber: 1,
      }),
    );
    expect(code).toBe('PROGRAM_COPY_CROSS_PROGRAM');
    expect(await daysOf(otherWeekId)).toEqual([]);
  });
});

describe('programs.weeks.duplicate', () => {
  it('copies a whole week — every day, and every block on every day — with fresh ids', async () => {
    const scene = await seedScene();

    const copy = await caller(scene.coach).programs.weeks.duplicate({
      sourceWeekId: scene.weekId,
    });

    expect(copy.id).not.toBe(scene.weekId);
    expect(copy.weekNumber).toBe(2);
    expect(copy.dayCount).toBe(2);

    const sourceDays = await daysOf(scene.weekId);
    const copiedDays = await daysOf(copy.id);

    // Every day keeps its slot, its name and its rest flag.
    expect(copiedDays.map((day) => [day.dayNumber, day.name, day.isRestDay])).toEqual(
      sourceDays.map((day) => [day.dayNumber, day.name, day.isRestDay]),
    );
    const sourceDayIds = new Set(sourceDays.map((day) => day.id));
    expect(copiedDays.filter((day) => sourceDayIds.has(day.id))).toEqual([]);

    // …and every block under every day, with the superset, the approved
    // swaps and the target weight intact.
    for (const [index, copiedDay] of copiedDays.entries()) {
      const sourceDay = sourceDays[index];
      if (!sourceDay) throw new Error('expected a matching source day');
      const source = await blocksOf(sourceDay.id);
      const copied = await blocksOf(copiedDay.id);
      expect(copied.map(carried)).toEqual(source.map(carried));
      const sourceBlockIds = new Set(source.map((block) => block.id));
      expect(copied.filter((block) => sourceBlockIds.has(block.id))).toEqual([]);
    }

    const trainingDayCopy = copiedDays.find((day) => !day.isRestDay);
    if (!trainingDayCopy) throw new Error('expected a training day in the copy');
    const trainingBlocks = await blocksOf(trainingDayCopy.id);
    expect(trainingBlocks.map((block) => block.supersetGroup)).toEqual(['A', 'A', null]);
    expect(trainingBlocks[2]?.alternatives).toEqual(scene.swapExerciseIds);
    expect(trainingBlocks[2]?.targetWeightKg).toBe('102.50');
  });

  it('appends past the last week and drags the declared length up with it', async () => {
    const scene = await seedScene();

    const first = await caller(scene.coach).programs.weeks.duplicate({
      sourceWeekId: scene.weekId,
    });
    const second = await caller(scene.coach).programs.weeks.duplicate({
      sourceWeekId: first.id,
    });
    expect([first.weekNumber, second.weekNumber]).toEqual([2, 3]);

    // Still 4, because the program was declared 4 weeks long and 3 sits
    // inside it — the declared length is a ceiling the authored weeks
    // raise, never one they lower (`program-builder/01`).
    const program = await caller(scene.coach).programs.get({ programId: scene.programId });
    expect(program.durationWeeks).toBe(4);
    expect(program.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3]);

    // Past the declared length, it is dragged up.
    await caller(scene.coach).programs.weeks.duplicate({ sourceWeekId: scene.weekId });
    await caller(scene.coach).programs.weeks.duplicate({ sourceWeekId: scene.weekId });
    const extended = await caller(scene.coach).programs.get({ programId: scene.programId });
    expect(extended.durationWeeks).toBe(5);
  });

  it('refuses an explicit week number that already exists with PROGRAM_WEEK_EXISTS', async () => {
    const scene = await seedScene();

    const code = await appCodeOf(
      caller(scene.coach).programs.weeks.duplicate({
        sourceWeekId: scene.weekId,
        targetWeekNumber: 1,
      }),
    );
    expect(code).toBe('PROGRAM_WEEK_EXISTS');

    const program = await caller(scene.coach).programs.get({ programId: scene.programId });
    expect(program.weeks).toHaveLength(1);
  });

  // An explicit 105 never reaches the resolver — `weekNumber`'s own bound
  // refuses it as `VALIDATION_FAILED` first. The ceiling is reachable the
  // one way the menu can actually reach it: appending past week 104.
  it('refuses appending past the 104 ceiling with PROGRAM_WEEK_LIMIT_REACHED', async () => {
    const scene = await seedScene();
    const last = await caller(scene.coach).programs.weeks.create({
      programId: scene.programId,
      weekNumber: 104,
    });

    const code = await appCodeOf(
      caller(scene.coach).programs.weeks.duplicate({ sourceWeekId: last.id }),
    );
    expect(code).toBe('PROGRAM_WEEK_LIMIT_REACHED');
  });
});

describe('the copy is one transaction', () => {
  // The risk the task names: "a partial duplication left uncommitted by a
  // mid-copy failure". Proved directly — the copy runs, then the
  // transaction fails after it, and neither the day nor a single block
  // survives. A half-copied day would look complete in the builder and be
  // empty when a client opened it.
  it('leaves nothing behind when the transaction fails after the copy', async () => {
    const scene = await seedScene();
    const boom = new Error('mid-copy failure');

    await expect(
      db.transaction(async (tx) => {
        await copyDaysInto(tx, [
          { sourceDayId: scene.dayId, targetWeekId: scene.weekId, targetDayNumber: 7 },
        ]);
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect((await daysOf(scene.weekId)).map((day) => day.dayNumber)).toEqual([2, 3]);
    // And no orphaned blocks: the source day still holds exactly its own
    // three, and nothing else in the program gained any.
    expect(await blocksOf(scene.dayId)).toHaveLength(3);
  });
});

describe('ownership is checked on BOTH sides of a copy', () => {
  it('refuses copying your own day into another coach’s week, and writes nothing', async () => {
    const mine = await seedScene();
    const theirs = await seedScene();

    const code = await appCodeOf(
      caller(mine.coach).programs.days.duplicate({
        sourceDayId: mine.dayId,
        targetWeekId: theirs.weekId,
        targetDayNumber: 1,
      }),
    );
    expect(code).toBe('NOT_YOUR_CLIENT');
    expect((await daysOf(theirs.weekId)).map((day) => day.dayNumber)).toEqual([2, 3]);
  });

  it('refuses copying another coach’s day into your own week', async () => {
    const mine = await seedScene();
    const theirs = await seedScene();

    const code = await appCodeOf(
      caller(mine.coach).programs.days.duplicate({
        sourceDayId: theirs.dayId,
        targetWeekId: mine.weekId,
        targetDayNumber: 1,
      }),
    );
    expect(code).toBe('NOT_YOUR_CLIENT');
    expect((await daysOf(mine.weekId)).map((day) => day.dayNumber)).toEqual([2, 3]);
  });

  it('refuses duplicating another coach’s week', async () => {
    const mine = await seedScene();
    const theirs = await seedScene();

    const code = await appCodeOf(
      caller(mine.coach).programs.weeks.duplicate({ sourceWeekId: theirs.weekId }),
    );
    expect(code).toBe('NOT_YOUR_CLIENT');
    const program = await caller(theirs.coach).programs.get({ programId: theirs.programId });
    expect(program.weeks).toHaveLength(1);
  });
});
