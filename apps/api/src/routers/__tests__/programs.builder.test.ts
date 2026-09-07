// Real Postgres (`testing` skill §4). Every assertion here is about a
// DB§5.2 constraint or an `ownsResource` refusal, and neither can be tested
// against a mock: the guarantees live in a unique index, a CHECK, and a
// WHERE clause, not in application logic a spy could observe.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
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
      email: `coach-${seq}@programs-builder-test.com`,
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

describe('programs.create → programs.get', () => {
  it('creates the shell the builder opens on: one program, week 1, no days', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({
      name: 'Hypertrophy block 2',
      description: 'Four-day upper/lower.',
      durationWeeks: 12,
    });

    const program = await caller(coach).programs.get({ programId: id });
    expect(program.name).toBe('Hypertrophy block 2');
    expect(program.description).toBe('Four-day upper/lower.');
    expect(program.durationWeeks).toBe(12);
    expect(program.isTemplate).toBe(true);
    expect(program.weeks).toHaveLength(1);
    expect(program.weeks[0]?.weekNumber).toBe(1);
    expect(program.weeks[0]?.days).toEqual([]);
  });

  // The task's stated safeguard, verified directly rather than inferred
  // from both procedures writing "the same tables": a program authored by
  // onboarding's minimal flow must open in this builder and extend from it.
  it('opens and extends a program created by onboarding’s minimal flow', async () => {
    const coach = await insertCoach();
    const [exercise] = await db
      .insert(schema.exercises)
      .values({
        name: `Onboarding Squat ${seq}`,
        primaryMuscle: 'quadriceps',
        equipment: 'barbell',
        movementPattern: 'squat',
      })
      .returning({ id: schema.exercises.id });
    if (!exercise) throw new Error('seed insert into exercises did not return a row');

    // Byte-for-byte the shape `coach-onboarding/03` sends: name + days, no
    // description and no durationWeeks.
    const { id } = await caller(coach).programs.create({
      name: 'Onboarding program',
      days: [
        {
          name: 'Full body A',
          exercises: [
            { exerciseId: exercise.id, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10 },
          ],
        },
        { name: 'Full body B', exercises: [] },
      ],
    });

    const opened = await caller(coach).programs.get({ programId: id });
    expect(opened.durationWeeks).toBe(1);
    expect(opened.weeks).toHaveLength(1);
    expect(opened.weeks[0]?.days.map((day) => day.dayNumber)).toEqual([1, 2]);
    expect(opened.weeks[0]?.days[0]?.exerciseCount).toBe(1);
    expect(opened.weeks[0]?.days[1]?.exerciseCount).toBe(0);

    // …and extends: a second week, a third day in week 1, and a longer
    // declared length, all against the same rows.
    const week2 = await caller(coach).programs.weeks.create({ programId: id });
    expect(week2.weekNumber).toBe(2);

    const firstWeekId = opened.weeks[0]?.id;
    if (!firstWeekId) throw new Error('expected week 1 to exist');
    await caller(coach).programs.days.create({
      programWeekId: firstWeekId,
      dayNumber: 4,
      name: 'Full body C',
    });
    await caller(coach).programs.update({ programId: id, durationWeeks: 8 });

    const extended = await caller(coach).programs.get({ programId: id });
    expect(extended.durationWeeks).toBe(8);
    expect(extended.weeks.map((week) => week.weekNumber)).toEqual([1, 2]);
    expect(extended.weeks[0]?.days.map((day) => day.dayNumber)).toEqual([1, 2, 4]);
  });
});

describe('week and day constraints surface product codes, never raw DB errors', () => {
  it('refuses a duplicate week number with PROGRAM_WEEK_EXISTS', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Dup week' });

    const code = await appCodeOf(
      caller(coach).programs.weeks.create({ programId: id, weekNumber: 1 }),
    );
    expect(code).toBe('PROGRAM_WEEK_EXISTS');
  });

  it('appends the next week number when none is supplied', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Append weeks' });

    expect((await caller(coach).programs.weeks.create({ programId: id })).weekNumber).toBe(2);
    expect((await caller(coach).programs.weeks.create({ programId: id })).weekNumber).toBe(3);

    // The declared length is dragged up with the authored weeks — it may
    // never sit below one that exists.
    const program = await caller(coach).programs.get({ programId: id });
    expect(program.durationWeeks).toBe(3);
  });

  it('refuses a duplicate day number in the same week with PROGRAM_DAY_TAKEN', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Dup day' });
    const program = await caller(coach).programs.get({ programId: id });
    const weekId = program.weeks[0]?.id;
    if (!weekId) throw new Error('expected week 1 to exist');

    await caller(coach).programs.days.create({
      programWeekId: weekId,
      dayNumber: 2,
      name: 'Lower',
    });
    const code = await appCodeOf(
      caller(coach).programs.days.create({
        programWeekId: weekId,
        dayNumber: 2,
        name: 'Something else',
      }),
    );
    expect(code).toBe('PROGRAM_DAY_TAKEN');
  });

  it('allows the same day number in a DIFFERENT week — the index is scoped to the week', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Same day, two weeks' });
    const week2 = await caller(coach).programs.weeks.create({ programId: id });
    const program = await caller(coach).programs.get({ programId: id });
    const week1Id = program.weeks[0]?.id;
    if (!week1Id) throw new Error('expected week 1 to exist');

    await caller(coach).programs.days.create({
      programWeekId: week1Id,
      dayNumber: 1,
      name: 'Push',
    });
    await caller(coach).programs.days.create({
      programWeekId: week2.id,
      dayNumber: 1,
      name: 'Push',
    });

    const after = await caller(coach).programs.get({ programId: id });
    expect(after.weeks.map((week) => week.days.length)).toEqual([1, 1]);
  });

  it('refuses moving a day onto a taken slot in its own week', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Move day' });
    const program = await caller(coach).programs.get({ programId: id });
    const weekId = program.weeks[0]?.id;
    if (!weekId) throw new Error('expected week 1 to exist');

    await caller(coach).programs.days.create({ programWeekId: weekId, dayNumber: 1, name: 'Push' });
    const moved = await caller(coach).programs.days.create({
      programWeekId: weekId,
      dayNumber: 3,
      name: 'Pull',
    });

    const code = await appCodeOf(
      caller(coach).programs.days.update({ programDayId: moved.id, dayNumber: 1 }),
    );
    expect(code).toBe('PROGRAM_DAY_TAKEN');

    // Moving onto a free slot still works, and renaming in place is not a
    // collision with itself.
    await caller(coach).programs.days.update({ programDayId: moved.id, dayNumber: 5 });
    await caller(coach).programs.days.update({
      programDayId: moved.id,
      dayNumber: 5,
      name: 'Pull A',
    });
    const after = await caller(coach).programs.get({ programId: id });
    expect(after.weeks[0]?.days.map((day) => [day.dayNumber, day.name])).toEqual([
      [1, 'Push'],
      [5, 'Pull A'],
    ]);
  });

  // The Zod bound and the CHECK say the same thing; the Zod one is what the
  // coach actually meets, and it must be a VALIDATION_FAILED rather than a
  // 23514 leaking through.
  it('rejects an out-of-range duration and an out-of-range day number in validation', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Bounds' });
    const program = await caller(coach).programs.get({ programId: id });
    const weekId = program.weeks[0]?.id;
    if (!weekId) throw new Error('expected week 1 to exist');

    await expect(
      caller(coach).programs.update({ programId: id, durationWeeks: 105 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(coach).programs.update({ programId: id, durationWeeks: 0 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(coach).programs.days.create({ programWeekId: weekId, dayNumber: 8, name: 'Eighth' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses appending past the 104-week ceiling with PROGRAM_WEEK_LIMIT_REACHED', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Ceiling' });
    // The last legal week, written directly rather than by appending 103
    // times — the ceiling is what is under test, not the append loop.
    await caller(coach).programs.weeks.create({ programId: id, weekNumber: 104 });

    const code = await appCodeOf(caller(coach).programs.weeks.create({ programId: id }));
    expect(code).toBe('PROGRAM_WEEK_LIMIT_REACHED');

    // An explicit 105 never reaches the resolver — the Zod bound mirrors
    // the same ceiling and answers first.
    await expect(
      caller(coach).programs.weeks.create({ programId: id, weekNumber: 105 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses shrinking the declared length below an authored week', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Shrink', durationWeeks: 6 });
    await caller(coach).programs.weeks.create({ programId: id });
    await caller(coach).programs.weeks.create({ programId: id });

    const code = await appCodeOf(
      caller(coach).programs.update({ programId: id, durationWeeks: 2 }),
    );
    expect(code).toBe('PROGRAM_DURATION_TOO_SHORT');

    // Nothing was written — the refusal happens inside the transaction.
    const [row] = await db
      .select({ durationWeeks: schema.programs.durationWeeks })
      .from(schema.programs)
      .where(eq(schema.programs.id, id));
    expect(row?.durationWeeks).toBe(6);

    // Down to exactly the last authored week is allowed.
    await caller(coach).programs.update({ programId: id, durationWeeks: 3 });
    expect((await caller(coach).programs.get({ programId: id })).durationWeeks).toBe(3);
  });
});

describe('deletion', () => {
  it('deleting a week takes its days with it and leaves the rest of the program alone', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Delete week' });
    const week2 = await caller(coach).programs.weeks.create({ programId: id });
    const day = await caller(coach).programs.days.create({
      programWeekId: week2.id,
      dayNumber: 1,
      name: 'Push',
    });

    await caller(coach).programs.weeks.delete({ programWeekId: week2.id });

    const after = await caller(coach).programs.get({ programId: id });
    expect(after.weeks.map((week) => week.weekNumber)).toEqual([1]);
    const orphans = await db
      .select({ id: schema.programDays.id })
      .from(schema.programDays)
      .where(eq(schema.programDays.id, day.id));
    expect(orphans).toEqual([]);
  });

  it('deleting a day removes only that day', async () => {
    const coach = await insertCoach();
    const { id } = await caller(coach).programs.create({ name: 'Delete day' });
    const program = await caller(coach).programs.get({ programId: id });
    const weekId = program.weeks[0]?.id;
    if (!weekId) throw new Error('expected week 1 to exist');

    const kept = await caller(coach).programs.days.create({
      programWeekId: weekId,
      dayNumber: 1,
      name: 'Push',
    });
    const dropped = await caller(coach).programs.days.create({
      programWeekId: weekId,
      dayNumber: 2,
      name: 'Pull',
    });

    await caller(coach).programs.days.delete({ programDayId: dropped.id });

    const after = await caller(coach).programs.get({ programId: id });
    expect(after.weeks[0]?.days.map((d) => d.id)).toEqual([kept.id]);
  });
});

// The enumeration test in `../../__tests__/authz.test.ts` already proves
// every one of these procedures refuses a foreign id. These assert the
// same thing end to end through the real hierarchy — a week and a day that
// resolve to their owner through one and two joins respectively, which is
// where a mis-written join would leak without the enumeration noticing.
describe('ownership', () => {
  it("refuses another coach's program, week, and day identically", async () => {
    const owner = await insertCoach();
    const stranger = await insertCoach();

    const { id } = await caller(owner).programs.create({ name: 'Private' });
    const program = await caller(owner).programs.get({ programId: id });
    const weekId = program.weeks[0]?.id;
    if (!weekId) throw new Error('expected week 1 to exist');
    const day = await caller(owner).programs.days.create({
      programWeekId: weekId,
      dayNumber: 1,
      name: 'Push',
    });

    expect(await appCodeOf(caller(stranger).programs.get({ programId: id }))).toBe(
      'NOT_YOUR_CLIENT',
    );
    expect(
      await appCodeOf(caller(stranger).programs.update({ programId: id, name: 'Mine now' })),
    ).toBe('NOT_YOUR_CLIENT');
    expect(await appCodeOf(caller(stranger).programs.weeks.create({ programId: id }))).toBe(
      'NOT_YOUR_CLIENT',
    );
    expect(await appCodeOf(caller(stranger).programs.weeks.delete({ programWeekId: weekId }))).toBe(
      'NOT_YOUR_CLIENT',
    );
    expect(
      await appCodeOf(
        caller(stranger).programs.days.create({
          programWeekId: weekId,
          dayNumber: 2,
          name: 'Intruder',
        }),
      ),
    ).toBe('NOT_YOUR_CLIENT');
    expect(
      await appCodeOf(caller(stranger).programs.days.update({ programDayId: day.id, name: 'X' })),
    ).toBe('NOT_YOUR_CLIENT');
    expect(await appCodeOf(caller(stranger).programs.days.delete({ programDayId: day.id }))).toBe(
      'NOT_YOUR_CLIENT',
    );

    // …and none of the refusals wrote anything.
    const after = await caller(owner).programs.get({ programId: id });
    expect(after.name).toBe('Private');
    expect(after.weeks[0]?.days.map((d) => d.name)).toEqual(['Push']);
  });
});
