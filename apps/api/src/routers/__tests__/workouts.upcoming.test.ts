// Real Postgres (`testing` skill §4). `phase-08-offline-core/prefetch/01`'s
// Verification: a client with sessions scheduled for today and tomorrow gets
// both, with the full live-resolved prescription and every referenced
// exercise — and never anything belonging to anybody else.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { addCalendarDays, isoWeekdayOfCalendarDate, toLocalDate } from '@coachos/utils';
import { TRPCError } from '@trpc/server';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { listUpcomingWorkouts } from '../../features/workouts/upcoming.ts';
import { isCatalogedError, type AppErrorCause } from '../../lib/app-error.ts';
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

interface ClientFixture {
  profileId: string;
  userId: string;
  ctx: Context;
}

async function insertCoach(): Promise<{ profileId: string; userId: string; ctx: Context }> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@upcoming-test.com`,
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
  return {
    profileId: profile.id,
    userId: user.id,
    ctx: createTestContext({ db, user: contextUser }),
  };
}

async function insertClient(coachProfileId: string): Promise<ClientFixture> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@upcoming-test.com`,
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
    .values({ userId: user.id, coachId: coachProfileId, status: 'active', activatedAt: new Date() })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');

  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: 'client',
    timezone: user.timezone,
    locale: user.locale,
    isMinor: user.isMinor,
    guardianConsentAt: user.guardianConsentAt,
    coachProfileId: null,
    clientProfileId: profile.id,
    deletionScheduledFor: null,
    deletedAt: null,
  };
  return {
    profileId: profile.id,
    userId: user.id,
    ctx: createTestContext({ db, user: contextUser }),
  };
}

async function insertExercise(name: string, demoAssetId: string | null = null): Promise<string> {
  seq += 1;
  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `${name} ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
      cues: ['Brace hard', 'Knees out'],
      defaultIncrementKg: '2.50',
      demoAssetId,
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

/** A one-day program whose single day carries one prescribed block. */
async function insertProgramDay(
  coachProfileId: string,
  block: { exerciseId: string; alternatives?: string[] },
): Promise<string> {
  seq += 1;
  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: coachProfileId, name: `Program ${seq}`, durationWeeks: 4 })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');
  const [week] = await db
    .insert(schema.programWeeks)
    .values({ programId: program.id, weekNumber: 1 })
    .returning({ id: schema.programWeeks.id });
  if (!week) throw new Error('seed insert into program_weeks did not return a row');
  const [day] = await db
    .insert(schema.programDays)
    .values({ programWeekId: week.id, dayNumber: 1, name: 'Push A', notes: 'Leave one in reserve' })
    .returning({ id: schema.programDays.id });
  if (!day) throw new Error('seed insert into program_days did not return a row');
  await db.insert(schema.programExercises).values({
    programDayId: day.id,
    exerciseId: block.exerciseId,
    orderIndex: 1,
    targetSets: 4,
    targetRepsMin: 6,
    targetRepsMax: 8,
    targetRpe: '8.5',
    targetWeightKg: '62.50',
    targetRestSeconds: 120,
    tempo: '3010',
    alternatives: block.alternatives ?? [],
    coachNotes: 'Film the top set',
  });
  return day.id;
}

/**
 * A program whose weeks and days are described explicitly, for the context
 * tests: rest days materialise no session, which is the whole reason
 * `UpcomingContext` exists.
 */
async function insertProgram(
  coachProfileId: string,
  spec: {
    durationWeeks: number;
    days: { weekNumber: number; dayNumber: number; name: string; isRestDay?: boolean }[];
  },
): Promise<{ programId: string; dayIds: Map<string, string>; name: string }> {
  seq += 1;
  const name = `Context Program ${seq}`;
  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: coachProfileId, name, durationWeeks: spec.durationWeeks })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

  const weekIds = new Map<number, string>();
  const dayIds = new Map<string, string>();
  for (const day of spec.days) {
    let weekId = weekIds.get(day.weekNumber);
    if (!weekId) {
      const [week] = await db
        .insert(schema.programWeeks)
        .values({ programId: program.id, weekNumber: day.weekNumber })
        .returning({ id: schema.programWeeks.id });
      if (!week) throw new Error('seed insert into program_weeks did not return a row');
      weekId = week.id;
      weekIds.set(day.weekNumber, weekId);
    }
    const [row] = await db
      .insert(schema.programDays)
      .values({
        programWeekId: weekId,
        dayNumber: day.dayNumber,
        name: day.name,
        isRestDay: day.isRestDay ?? false,
      })
      .returning({ id: schema.programDays.id });
    if (!row) throw new Error('seed insert into program_days did not return a row');
    dayIds.set(`${String(day.weekNumber)}:${String(day.dayNumber)}`, row.id);
  }

  return { programId: program.id, dayIds, name };
}

async function insertAssignment(args: {
  programId: string;
  clientId: string;
  coachId: string;
  startDate: string;
}): Promise<string> {
  const [assignment] = await db
    .insert(schema.assignments)
    .values({
      programId: args.programId,
      clientId: args.clientId,
      coachId: args.coachId,
      startDate: args.startDate,
      status: 'active',
    })
    .returning({ id: schema.assignments.id });
  if (!assignment) throw new Error('seed insert into assignments did not return a row');
  return assignment.id;
}

async function insertSession(args: {
  clientId: string;
  coachId: string;
  programDayId: string | null;
  scheduledDate: string;
  deletedAt?: Date;
}): Promise<string> {
  const [session] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: args.clientId,
      coachId: args.coachId,
      programDayId: args.programDayId,
      scheduledDate: args.scheduledDate,
      status: 'scheduled',
      deletedAt: args.deletedAt ?? null,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!session) throw new Error('seed insert into workout_sessions did not return a row');
  return session.id;
}

// Both fixture clients are `timezone: 'UTC'`, so "today" here is the same
// calendar day the device would compute for them.
const today = toLocalDate(new Date(), 'UTC');
const tomorrow = addCalendarDays(today, 1);
const nextWeek = addCalendarDays(today, 7);

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

/** The catalogued `cause` of a rejected call — never its message. */
async function causeOf(call: Promise<unknown>): Promise<AppErrorCause> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCError && isCatalogedError(error)) return error.cause;
    throw error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('workouts.upcoming', () => {
  it("returns today's and tomorrow's sessions with the live-resolved prescription", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const exerciseId = await insertExercise('Back Squat');
    const dayId = await insertProgramDay(coach.profileId, { exerciseId });
    const todayId = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });
    const tomorrowId = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: tomorrow,
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: tomorrow });

    expect(result.sessions.map((session) => session.id)).toEqual([todayId, tomorrowId]);
    expect(result.sessions[0]).toMatchObject({
      scheduledDate: today,
      status: 'scheduled',
      dayName: 'Push A',
      dayNotes: 'Leave one in reserve',
    });
    // The prescription is resolved live from `program_day_id`, and every
    // `numeric` arrives as a number, not a Postgres string.
    expect(result.sessions[0]?.exercises).toEqual([
      expect.objectContaining({
        exerciseId,
        orderIndex: 1,
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetRpe: 8.5,
        targetWeightKg: 62.5,
        targetRestSeconds: 120,
        tempo: '3010',
        coachNotes: 'Film the top set',
      }),
    ]);
  });

  it('caches every referenced exercise, including the coach-approved swaps', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const exerciseId = await insertExercise('Front Squat');
    const alternativeId = await insertExercise('Goblet Squat');
    const dayId = await insertProgramDay(coach.profileId, {
      exerciseId,
      alternatives: [alternativeId],
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: tomorrow });

    expect(result.exercises.map((exercise) => exercise.id).sort()).toEqual(
      [exerciseId, alternativeId].sort(),
    );
    const prescribed = result.exercises.find((exercise) => exercise.id === exerciseId);
    expect(prescribed).toMatchObject({
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
      isBodyweight: false,
      defaultIncrementKg: 2.5,
      cues: ['Brace hard', 'Knees out'],
      demoAssetId: null,
      demoVideoUrl: null,
    });
  });

  it('excludes sessions outside the range and soft-deleted ones', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const exerciseId = await insertExercise('Deadlift');
    const dayId = await insertProgramDay(coach.profileId, { exerciseId });
    const inRange = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: null,
      scheduledDate: nextWeek,
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: null,
      scheduledDate: tomorrow,
      deletedAt: new Date(),
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: tomorrow });

    expect(result.sessions.map((session) => session.id)).toEqual([inRange]);
  });

  it("never returns another client's sessions, even under the same coach", async () => {
    const coach = await insertCoach();
    const mine = await insertClient(coach.profileId);
    const theirs = await insertClient(coach.profileId);
    const exerciseId = await insertExercise('Bench Press');
    const dayId = await insertProgramDay(coach.profileId, { exerciseId });
    const mySession = await insertSession({
      clientId: mine.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });
    await insertSession({
      clientId: theirs.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });

    const result = await caller(mine.ctx).workouts.upcoming({ from: today, to: tomorrow });

    // The client is read from `ctx.user`, never from the wire — there is no
    // input a caller could put someone else's id in.
    expect(result.sessions.map((session) => session.id)).toEqual([mySession]);
  });

  it('rejects a coach — this is a client-only read', async () => {
    const coach = await insertCoach();

    const cause = await causeOf(caller(coach.ctx).workouts.upcoming({ from: today, to: tomorrow }));

    expect(cause.appCode).toBe('ROLE_REQUIRED');
  });

  it('rejects an anonymous caller', async () => {
    const anonymous = createTestContext({ db, user: null });

    const cause = await causeOf(caller(anonymous).workouts.upcoming({ from: today, to: tomorrow }));

    expect(cause.appCode).toBe('AUTH_REQUIRED');
  });

  it('rejects an inverted range', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);

    await expect(
      caller(client.ctx).workouts.upcoming({ from: tomorrow, to: today }),
    ).rejects.toThrow();
  });

  it('resolves the demo video URL for a ready asset, and null for one still processing', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    seq += 1;
    const readyKey = `demos/ready-${seq}.mp4`;
    const processingKey = `demos/processing-${seq}.mp4`;
    const [readyAsset] = await db
      .insert(schema.mediaAssets)
      .values({
        ownerUserId: coach.userId,
        coachId: coach.profileId,
        kind: 'video',
        storageKey: readyKey,
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        processingStatus: 'ready',
      })
      .returning({ id: schema.mediaAssets.id });
    const [processingAsset] = await db
      .insert(schema.mediaAssets)
      .values({
        ownerUserId: coach.userId,
        coachId: coach.profileId,
        kind: 'video',
        storageKey: processingKey,
        mimeType: 'video/mp4',
        sizeBytes: 1024,
        processingStatus: 'processing',
      })
      .returning({ id: schema.mediaAssets.id });
    if (!readyAsset || !processingAsset) throw new Error('seed insert into media_assets failed');

    const withDemo = await insertExercise('Overhead Press', readyAsset.id);
    const withoutDemo = await insertExercise('Row', processingAsset.id);
    const dayId = await insertProgramDay(coach.profileId, {
      exerciseId: withDemo,
      alternatives: [withoutDemo],
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: dayId,
      scheduledDate: today,
    });

    // The resolver is injected: signing needs live R2 credentials, and
    // `upcoming.ts` decision (d) is about *which* assets get a URL at all,
    // not about the signature itself.
    const result = await listUpcomingWorkouts(
      db,
      client.profileId,
      { from: today, to: tomorrow },
      { resolveDemoUrl: async (storageKey) => `https://r2.test/${storageKey}` },
    );

    expect(result.exercises.find((exercise) => exercise.id === withDemo)?.demoVideoUrl).toBe(
      `https://r2.test/${readyKey}`,
    );
    expect(
      result.exercises.find((exercise) => exercise.id === withoutDemo)?.demoVideoUrl,
    ).toBeNull();
  });
});

// `phase-09-workout-logger/today-card/01` — the API gap
// `today-card/DESIGN-SPEC.md` §5.1 documents. A rest day materialises NO
// session row (`lib/materialise-sessions.ts`: `if (day.isRestDay) continue`),
// so "no row for today" is ambiguous on the device between *rest day*, *a
// day the program leaves unprogrammed*, and *no program at all*. Task 03
// has to render three different screens for those and cannot without this
// object.
//
// `today` is whatever day the suite runs on, so every start date below is
// derived from it rather than hardcoded — otherwise the suite would pass or
// fail depending on the calendar.
describe('workouts.upcoming - context', () => {
  /** The Monday of the calendar week `today` falls in — materialisation's own anchor. */
  const mondayOfThisWeek = addCalendarDays(today, -(isoWeekdayOfCalendarDate(today) - 1));
  const todayNumber = isoWeekdayOfCalendarDate(today);
  const tomorrowNumber = isoWeekdayOfCalendarDate(tomorrow);

  it('reports no active assignment, and still answers for every date in the range', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: tomorrow });

    expect(result.context).toEqual({
      hasActiveAssignment: false,
      programName: null,
      totalWeeks: null,
      days: [
        { date: today, isRestDay: false, weekNumber: null, dayName: null },
        { date: tomorrow, isRestDay: false, weekNumber: null, dayName: null },
      ],
    });
  });

  it("reports today's rest day, which has no session row to infer it from", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, {
      durationWeeks: 12,
      days: [{ weekNumber: 1, dayNumber: todayNumber, name: 'Rest', isRestDay: true }],
    });
    await insertAssignment({
      programId: program.programId,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: mondayOfThisWeek,
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: today });

    // No session at all — exactly the ambiguity this object resolves.
    expect(result.sessions).toEqual([]);
    expect(result.context.hasActiveAssignment).toBe(true);
    expect(result.context.days).toEqual([
      { date: today, isRestDay: true, weekNumber: 1, dayName: 'Rest' },
    ]);
  });

  it('supplies the header its "Week n of m" and the program name', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, {
      durationWeeks: 12,
      days: [{ weekNumber: 6, dayNumber: todayNumber, name: 'Upper A' }],
    });
    // Started five weeks ago, so this calendar week is the program's week 6.
    await insertAssignment({
      programId: program.programId,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: addCalendarDays(mondayOfThisWeek, -35),
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: today });

    expect(result.context).toMatchObject({
      hasActiveAssignment: true,
      programName: program.name,
      totalWeeks: 12,
    });
    expect(result.context.days[0]).toEqual({
      date: today,
      isRestDay: false,
      weekNumber: 6,
      dayName: 'Upper A',
    });
  });

  it('answers per date, not once for the range', async () => {
    // The reason `days` is a list rather than DESIGN-SPEC 5.1's flat
    // scalars: a client opening the app just after midnight, before the
    // nightly prefetch runs, must not be shown yesterday's answer.
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const days: { weekNumber: number; dayNumber: number; name: string; isRestDay?: boolean }[] = [
      { weekNumber: 1, dayNumber: todayNumber, name: 'Rest', isRestDay: true },
    ];
    // A Sunday "today" puts tomorrow in week 2; the day is still programmed,
    // it just belongs to the next week's row.
    days.push({
      weekNumber: tomorrowNumber > todayNumber ? 1 : 2,
      dayNumber: tomorrowNumber,
      name: 'Lower B',
    });
    const program = await insertProgram(coach.profileId, { durationWeeks: 12, days });
    await insertAssignment({
      programId: program.programId,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: mondayOfThisWeek,
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: tomorrow });

    expect(result.context.days).toHaveLength(2);
    expect(result.context.days[0]).toMatchObject({ date: today, isRestDay: true, dayName: 'Rest' });
    expect(result.context.days[1]).toMatchObject({
      date: tomorrow,
      isRestDay: false,
      dayName: 'Lower B',
    });
  });

  it('reports a week that exists but leaves this day unprogrammed - not a rest day', async () => {
    // Distinct from a rest day, and the card says so: the chip reads
    // "Nothing scheduled" rather than "Rest day" (DESIGN-SPEC 3.4).
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const otherDay = todayNumber === 7 ? 1 : todayNumber + 1;
    const program = await insertProgram(coach.profileId, {
      durationWeeks: 12,
      days: [{ weekNumber: 1, dayNumber: otherDay, name: 'Upper A' }],
    });
    await insertAssignment({
      programId: program.programId,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: mondayOfThisWeek,
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: today });

    expect(result.context.days[0]).toEqual({
      date: today,
      isRestDay: false,
      weekNumber: 1,
      dayName: null,
    });
  });

  it("reports no week for a date past the program's final week", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, {
      durationWeeks: 1,
      days: [{ weekNumber: 1, dayNumber: todayNumber, name: 'Upper A' }],
    });
    // Started four weeks ago: a one-week program has long since run out.
    await insertAssignment({
      programId: program.programId,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: addCalendarDays(mondayOfThisWeek, -28),
    });

    const result = await caller(client.ctx).workouts.upcoming({ from: today, to: today });

    expect(result.context).toMatchObject({ hasActiveAssignment: true, totalWeeks: 1 });
    // Never "Week 5 of 1": the week does not exist, so the header drops the
    // segment rather than inventing one.
    expect(result.context.days[0]).toEqual({
      date: today,
      isRestDay: false,
      weekNumber: null,
      dayName: null,
    });
  });

  it("never reads another client's assignment", async () => {
    const coach = await insertCoach();
    const mine = await insertClient(coach.profileId);
    const theirs = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, {
      durationWeeks: 12,
      days: [{ weekNumber: 1, dayNumber: todayNumber, name: 'Upper A' }],
    });
    await insertAssignment({
      programId: program.programId,
      clientId: theirs.profileId,
      coachId: coach.profileId,
      startDate: mondayOfThisWeek,
    });

    const result = await caller(mine.ctx).workouts.upcoming({ from: today, to: today });

    expect(result.context.hasActiveAssignment).toBe(false);
    expect(result.context.programName).toBeNull();
  });
});

// `phase-09-workout-logger/today-card/02` — the two consumers of this read
// address it by two different mechanisms, and only one of them typechecks.
// The Today card calls `api.workouts.upcoming` (inferred from `AppRouter`),
// but `apps/mobile/src/lib/prefetch/trpc-client.ts` is an UNTYPED client and
// `lib/prefetch/sessions.ts` names the procedure with the string literal
// below. Renaming or moving the procedure would break prefetch silently, at
// runtime, on the one screen that has to work with no signal — so the string
// gets an assertion rather than trust.
describe('the procedure path prefetch and the Today card share', () => {
  it("resolves 'workouts.upcoming', the literal the untyped prefetch client sends", () => {
    expect(Object.keys(appRouter._def.procedures)).toContain('workouts.upcoming');
  });
});
