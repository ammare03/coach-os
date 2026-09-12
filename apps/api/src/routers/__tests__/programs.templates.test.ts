// Real Postgres (`testing` skill §4). `program-templates/02`'s Verification,
// performed: duplicate a multi-week program carrying a superset and
// approved swaps, confirm the copy is complete and fully independent, then
// prove editing one side does not touch the other. None of that can be
// proven against a mock — the fidelity claim is about what Postgres
// actually holds after the write, and the independence claim is about
// whether a later write to one program's rows can reach the other's.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient, type ProgramExercise } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { carriedExerciseColumns } from '../../features/programs/copy-program-days.ts';
import type * as CopyProgramDaysModule from '../../features/programs/copy-program-days.ts';
import type * as DuplicateProgramModule from '../../features/programs/duplicate-program.ts';
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
      email: `coach-${seq}@programs-templates-test.com`,
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
    deletionScheduledFor: null,
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
  week1Id: string;
  week2Id: string;
  trainingDayId: string;
  restDayId: string;
  swapExerciseIds: string[];
}

/**
 * A two-week template: week 1 holds a training day (a superset spanning
 * two blocks, a third block with an absolute target weight and three
 * approved swaps) and a rest day; week 2 holds one plain day. Everything a
 * whole-program copy has to reproduce shows up here.
 */
async function seedTemplate(): Promise<Scene> {
  const coach = await insertCoach();
  const { id: programId } = await caller(coach).programs.create({
    name: 'Hypertrophy template',
    durationWeeks: 2,
  });
  const program = await caller(coach).programs.get({ programId });
  const week1Id = program.weeks[0]?.id;
  if (!week1Id) throw new Error('expected week 1 to exist');
  const { id: week2Id } = await caller(coach).programs.weeks.create({
    programId,
    weekNumber: 2,
  });

  const trainingDay = await caller(coach).programs.days.create({
    programWeekId: week1Id,
    dayNumber: 2,
    name: 'Lower — squat focus',
    notes: 'Push the top set, leave the back-offs alone.',
  });
  const restDay = await caller(coach).programs.days.create({
    programWeekId: week1Id,
    dayNumber: 3,
    name: 'Rest',
    isRestDay: true,
  });
  await caller(coach).programs.days.create({
    programWeekId: week2Id,
    dayNumber: 1,
    name: 'Upper — press focus',
  });

  const squatId = await insertExercise('Barbell Back Squat');
  const legCurlId = await insertExercise('Lying Leg Curl');
  const pressId = await insertExercise('Leg Press');
  const hackId = await insertExercise('Hack Squat');
  const gobletId = await insertExercise('Goblet Squat');

  const first = await caller(coach).programs.exercises.create({
    programDayId: trainingDay.id,
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
    programDayId: trainingDay.id,
    exerciseId: legCurlId,
    targetSets: 3,
    targetRepsMin: 10,
    targetRepsMax: 12,
    targetRir: 2,
  });
  const third = await caller(coach).programs.exercises.create({
    programDayId: trainingDay.id,
    exerciseId: pressId,
    targetSets: 3,
    targetRepsMin: 5,
    targetRepsMax: 5,
    targetWeightKg: 102.5,
    tempo: '20X0',
  });

  await caller(coach).programs.exercises.setSupersetGroup({
    programDayId: trainingDay.id,
    exerciseIds: [first.id, second.id],
    group: 'A',
  });
  const swapExerciseIds = [hackId, gobletId, squatId];
  await caller(coach).programs.exercises.setAlternatives({
    programExerciseId: third.id,
    alternativeExerciseIds: swapExerciseIds,
  });

  return {
    coach,
    programId,
    week1Id,
    week2Id,
    trainingDayId: trainingDay.id,
    restDayId: restDay.id,
    swapExerciseIds,
  };
}

async function weeksOf(programId: string) {
  return db
    .select()
    .from(schema.programWeeks)
    .where(eq(schema.programWeeks.programId, programId))
    .orderBy(asc(schema.programWeeks.weekNumber));
}

async function daysOf(programWeekId: string) {
  return db
    .select()
    .from(schema.programDays)
    .where(eq(schema.programDays.programWeekId, programWeekId))
    .orderBy(asc(schema.programDays.dayNumber));
}

async function blocksOf(programDayId: string): Promise<ProgramExercise[]> {
  return db
    .select()
    .from(schema.programExercises)
    .where(eq(schema.programExercises.programDayId, programDayId))
    .orderBy(asc(schema.programExercises.orderIndex));
}

/** Everything but identity, parent and audit stamps — the production omission itself. */
const carried = carriedExerciseColumns;

describe('programs.duplicate', () => {
  it('deep-copies the entire hierarchy — every week, day and block, with fresh ids throughout', async () => {
    const scene = await seedTemplate();

    const copy = await caller(scene.coach).programs.duplicate({
      sourceProgramId: scene.programId,
      newName: 'Client A — Hypertrophy',
    });
    expect(copy.id).not.toBe(scene.programId);

    const sourceProgram = await caller(scene.coach).programs.get({ programId: scene.programId });
    const copyProgram = await caller(scene.coach).programs.get({ programId: copy.id });

    expect(copyProgram.name).toBe('Client A — Hypertrophy');
    expect(copyProgram.durationWeeks).toBe(sourceProgram.durationWeeks);
    expect(copyProgram.isTemplate).toBe(sourceProgram.isTemplate);
    // A fresh copy starts its own version and lifecycle — not the
    // source's, and not carried forward.
    expect(copyProgram.version).toBe(1);

    const sourceWeeks = await weeksOf(scene.programId);
    const copiedWeeks = await weeksOf(copy.id);
    expect(copiedWeeks.map((w) => w.weekNumber)).toEqual(sourceWeeks.map((w) => w.weekNumber));
    expect(copiedWeeks.map((w) => w.notes)).toEqual(sourceWeeks.map((w) => w.notes));
    const sourceWeekIds = new Set(sourceWeeks.map((w) => w.id));
    expect(copiedWeeks.filter((w) => sourceWeekIds.has(w.id))).toEqual([]);
    expect(copiedWeeks.every((w) => w.programId === copy.id)).toBe(true);

    for (const [index, sourceWeek] of sourceWeeks.entries()) {
      const copiedWeek = copiedWeeks[index];
      if (!copiedWeek) throw new Error('expected a matching copied week');

      const sourceDays = await daysOf(sourceWeek.id);
      const copiedDays = await daysOf(copiedWeek.id);
      expect(copiedDays.map((d) => [d.dayNumber, d.name, d.notes, d.isRestDay])).toEqual(
        sourceDays.map((d) => [d.dayNumber, d.name, d.notes, d.isRestDay]),
      );
      const sourceDayIds = new Set(sourceDays.map((d) => d.id));
      expect(copiedDays.filter((d) => sourceDayIds.has(d.id))).toEqual([]);
      expect(copiedDays.every((d) => d.programWeekId === copiedWeek.id)).toBe(true);

      for (const [dayIndex, sourceDay] of sourceDays.entries()) {
        const copiedDay = copiedDays[dayIndex];
        if (!copiedDay) throw new Error('expected a matching copied day');
        const sourceBlocks = await blocksOf(sourceDay.id);
        const copiedBlocks = await blocksOf(copiedDay.id);
        expect(copiedBlocks.map(carried)).toEqual(sourceBlocks.map(carried));
        const sourceBlockIds = new Set(sourceBlocks.map((b) => b.id));
        expect(copiedBlocks.filter((b) => sourceBlockIds.has(b.id))).toEqual([]);
        expect(copiedBlocks.every((b) => b.programDayId === copiedDay.id)).toBe(true);
      }
    }

    // Spelled out for the three the task names, so a regression says which
    // one it broke rather than dumping two arrays.
    const copiedWeek1 = copiedWeeks[0];
    if (!copiedWeek1) throw new Error('expected copied week 1');
    const copiedTrainingDay = (await daysOf(copiedWeek1.id)).find((d) => !d.isRestDay);
    if (!copiedTrainingDay) throw new Error('expected a copied training day');
    const copiedBlocks = await blocksOf(copiedTrainingDay.id);
    expect(copiedBlocks.map((b) => b.supersetGroup)).toEqual(['A', 'A', null]);
    expect(copiedBlocks[2]?.alternatives).toEqual(scene.swapExerciseIds);
    expect(copiedBlocks[2]?.targetWeightKg).toBe('102.50');
  });

  it('leaves the source program completely untouched', async () => {
    const scene = await seedTemplate();
    const before = await caller(scene.coach).programs.get({ programId: scene.programId });

    await caller(scene.coach).programs.duplicate({
      sourceProgramId: scene.programId,
      newName: 'Copy',
    });

    const after = await caller(scene.coach).programs.get({ programId: scene.programId });
    expect(after).toEqual(before);
  });

  it('is fully independent — editing the copy does not affect the source, and vice versa', async () => {
    const scene = await seedTemplate();
    const copy = await caller(scene.coach).programs.duplicate({
      sourceProgramId: scene.programId,
      newName: 'Client B — Hypertrophy',
    });

    const copyWeek1 = (await weeksOf(copy.id))[0];
    if (!copyWeek1) throw new Error('expected copied week 1');
    const copyTrainingDay = (await daysOf(copyWeek1.id)).find((d) => !d.isRestDay);
    if (!copyTrainingDay) throw new Error('expected a copied training day');
    const copyBlocks = await blocksOf(copyTrainingDay.id);
    const copyThirdBlock = copyBlocks[2];
    if (!copyThirdBlock) throw new Error('expected a third copied block');

    // Edit the copy: rename its training day, and bump the copy's third
    // block to 5 sets.
    await caller(scene.coach).programs.days.update({
      programDayId: copyTrainingDay.id,
      name: 'Lower — renamed on the copy',
    });
    await caller(scene.coach).programs.exercises.update({
      programExerciseId: copyThirdBlock.id,
      targetSets: 5,
      targetRepsMin: 5,
      targetRepsMax: 5,
      targetWeightKg: 102.5,
      tempo: '20X0',
    });

    const sourceDayAfter = await db
      .select()
      .from(schema.programDays)
      .where(eq(schema.programDays.id, scene.trainingDayId));
    expect(sourceDayAfter[0]?.name).toBe('Lower — squat focus');
    const sourceBlocksAfter = await blocksOf(scene.trainingDayId);
    expect(sourceBlocksAfter[2]?.targetSets).toBe(3);

    // Edit the source: rename its rest day.
    await caller(scene.coach).programs.days.update({
      programDayId: scene.restDayId,
      name: 'Rest — renamed on the source',
    });

    const copyWeek1Again = (await weeksOf(copy.id))[0];
    if (!copyWeek1Again) throw new Error('expected copied week 1');
    const copyWeek1Days = await daysOf(copyWeek1Again.id);
    const copyRestDay = copyWeek1Days.find((d) => d.isRestDay);
    expect(copyRestDay?.name).toBe('Rest');
  });

  it('refuses another coach’s program with NOT_YOUR_CLIENT, and creates nothing', async () => {
    const scene = await seedTemplate();
    const attacker = await insertCoach();

    const programsBefore = await db
      .select({ id: schema.programs.id })
      .from(schema.programs)
      .where(eq(schema.programs.coachId, attacker.profileId));
    expect(programsBefore).toEqual([]);

    const code = await appCodeOf(
      caller(attacker).programs.duplicate({
        sourceProgramId: scene.programId,
        newName: 'Stolen copy',
      }),
    );
    expect(code).toBe('NOT_YOUR_CLIENT');

    const programsAfter = await db
      .select({ id: schema.programs.id })
      .from(schema.programs)
      .where(eq(schema.programs.coachId, attacker.profileId));
    expect(programsAfter).toEqual([]);
  });
});

describe('programs.duplicate is one transaction', () => {
  it('leaves nothing behind when the copy fails partway through', async () => {
    const scene = await seedTemplate();
    const programCountBefore = await db.select({ id: schema.programs.id }).from(schema.programs);

    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../features/programs/copy-program-days.ts', () => {
        const actual = jest.requireActual<typeof CopyProgramDaysModule>(
          '../../features/programs/copy-program-days.ts',
        );
        return {
          ...actual,
          copyDaysInto: jest.fn(async (...args: Parameters<typeof actual.copyDaysInto>) => {
            await actual.copyDaysInto(...args);
            throw new Error('mid-copy failure');
          }),
        };
      });

      const { duplicateProgram }: typeof DuplicateProgramModule =
        await import('../../features/programs/duplicate-program.ts');

      await expect(
        duplicateProgram(db, scene.coach.profileId, {
          sourceProgramId: scene.programId,
          newName: 'Should not exist',
        }),
      ).rejects.toThrow('mid-copy failure');
    });

    const programCountAfter = await db.select({ id: schema.programs.id }).from(schema.programs);
    expect(programCountAfter).toHaveLength(programCountBefore.length);
  });
});
