// Real Postgres (`testing` skill §4). `phase-08-offline-core/prefetch/02`'s
// Verification, for both reads it defines: the top-100 foods must reflect
// THIS client's own logging, and the 30-day history must come back complete
// — sessions with their sets, meals with their items, and every comment on
// the client's own work — and never anything belonging to anybody else.
//
// Both procedures share one container: they are one task's reads, and a
// second testcontainer buys nothing but two more minutes of Docker.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
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

interface Actor {
  profileId: string;
  userId: string;
  ctx: Context;
}

async function insertCoach(): Promise<Actor> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@prefetch-test.com`,
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
  return {
    profileId: profile.id,
    userId: user.id,
    ctx: createTestContext({ db, user: contextUser }),
  };
}

async function insertClient(coachProfileId: string, timezone = 'UTC'): Promise<Actor> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@prefetch-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone,
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
    deletedAt: null,
  };
  return {
    profileId: profile.id,
    userId: user.id,
    ctx: createTestContext({ db, user: contextUser }),
  };
}

async function insertFood(args: {
  name: string;
  usageCount?: number;
  caloriesPer100g?: string;
}): Promise<string> {
  seq += 1;
  const [food] = await db
    .insert(schema.foods)
    .values({
      source: 'usda',
      externalId: `ext-${seq}`,
      name: `${args.name} ${seq}`,
      brand: 'Testbrand',
      caloriesPer100g: args.caloriesPer100g ?? '165.00',
      proteinG: '31.00',
      carbsG: '0.00',
      fatG: '3.60',
      servingSizeG: '100.00',
      servingLabel: '1 breast',
      usageCount: args.usageCount ?? 0,
    })
    .returning({ id: schema.foods.id });
  if (!food) throw new Error('seed insert into foods did not return a row');
  return food.id;
}

async function insertMeal(args: {
  clientId: string;
  coachId: string;
  loggedDate: string;
  loggedAt?: Date;
  deletedAt?: Date;
  items?: { foodId?: string; customName?: string }[];
}): Promise<string> {
  seq += 1;
  const [meal] = await db
    .insert(schema.meals)
    .values({
      clientId: args.clientId,
      coachId: args.coachId,
      loggedDate: args.loggedDate,
      mealType: 'lunch',
      loggedAt: args.loggedAt ?? new Date(`${args.loggedDate}T12:00:00.000Z`),
      notes: 'Post-session',
      clientLocalId: `meal-local-${seq}`,
      deletedAt: args.deletedAt ?? null,
    })
    .returning({ id: schema.meals.id });
  if (!meal) throw new Error('seed insert into meals did not return a row');

  for (const item of args.items ?? []) {
    await db.insert(schema.mealItems).values({
      mealId: meal.id,
      foodId: item.foodId ?? null,
      customName: item.customName ?? null,
      quantityG: '150.00',
      calories: '247.50',
      proteinG: '46.50',
      carbsG: '0.00',
      fatG: '5.40',
    });
  }
  return meal.id;
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
      cues: ['Brace hard'],
      defaultIncrementKg: '2.50',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

async function insertSession(args: {
  clientId: string;
  coachId: string;
  scheduledDate: string;
  deletedAt?: Date;
}): Promise<string> {
  const [session] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: args.clientId,
      coachId: args.coachId,
      scheduledDate: args.scheduledDate,
      status: 'completed',
      // `session_completion` requires both timestamps on a completed row.
      startedAt: new Date(`${args.scheduledDate}T17:00:00.000Z`),
      completedAt: new Date(`${args.scheduledDate}T18:00:00.000Z`),
      durationSeconds: 3600,
      perceivedExertion: 8,
      clientNotes: 'Felt strong',
      totalVolumeKg: '5400.00',
      deletedAt: args.deletedAt ?? null,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!session) throw new Error('seed insert into workout_sessions did not return a row');
  return session.id;
}

async function insertSetLog(args: {
  sessionId: string;
  clientId: string;
  exerciseId: string;
  setNumber: number;
  deletedAt?: Date;
}): Promise<string> {
  seq += 1;
  const [setLog] = await db
    .insert(schema.setLogs)
    .values({
      workoutSessionId: args.sessionId,
      clientId: args.clientId,
      exerciseId: args.exerciseId,
      setNumber: args.setNumber,
      reps: 5,
      weightKg: '102.50',
      rpe: '8.5',
      clientLocalId: `set-local-${seq}`,
      loggedAt: new Date('2026-08-10T18:10:00.000Z'),
      deletedAt: args.deletedAt ?? null,
    })
    .returning({ id: schema.setLogs.id });
  if (!setLog) throw new Error('seed insert into set_logs did not return a row');
  return setLog.id;
}

async function insertComment(args: {
  authorUserId: string;
  clientId: string;
  targetId: string;
  body: string;
  createdAt: Date;
  deletedAt?: Date;
}): Promise<string> {
  const [comment] = await db
    .insert(schema.comments)
    .values({
      authorUserId: args.authorUserId,
      targetType: 'workout_session',
      targetId: args.targetId,
      clientId: args.clientId,
      body: args.body,
      createdAt: args.createdAt,
      deletedAt: args.deletedAt ?? null,
    })
    .returning({ id: schema.comments.id });
  if (!comment) throw new Error('seed insert into comments did not return a row');
  return comment.id;
}

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

describe('nutrition.myFoods', () => {
  it("ranks by the client's OWN logging frequency, not global popularity", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    // The globally popular food this client has logged once, against the
    // obscure one they log every day. Task 02's named risk: a global
    // ranking would put these the wrong way round.
    const popularGlobally = await insertFood({ name: 'Chicken Breast', usageCount: 100_000 });
    const theirStaple = await insertFood({ name: 'Ragi Mudde', usageCount: 1 });

    await insertMeal({
      clientId: client.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-08-01',
      items: [{ foodId: popularGlobally }],
    });
    for (const day of ['2026-08-01', '2026-08-02', '2026-08-03']) {
      await insertMeal({
        clientId: client.profileId,
        coachId: coach.profileId,
        loggedDate: day,
        items: [{ foodId: theirStaple }],
      });
    }

    const result = await caller(client.ctx).nutrition.myFoods({ limit: 2 });

    expect(result.map((food) => food.id)).toEqual([theirStaple, popularGlobally]);
    expect(result[0]).toMatchObject({ ranking: 'personal', logCount: 3 });
    expect(result[1]).toMatchObject({ ranking: 'personal', logCount: 1 });
    // `numeric` arrives as a number, not a Postgres string.
    expect(result[0]?.caloriesPer100g).toBe(165);
    expect(result[0]?.proteinG).toBe(31);
  });

  it('tops up with globally popular foods only after the personal ones', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const theirs = await insertFood({ name: 'Paneer', usageCount: 0 });
    const popular = await insertFood({ name: 'Oats', usageCount: 999_999 });
    await insertMeal({
      clientId: client.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-08-01',
      items: [{ foodId: theirs }],
    });

    const result = await caller(client.ctx).nutrition.myFoods({ limit: 2 });

    expect(result[0]).toMatchObject({ id: theirs, ranking: 'personal', logCount: 1 });
    const topUp = result.slice(1);
    expect(topUp.every((food) => food.ranking === 'global')).toBe(true);
    expect(topUp.map((food) => food.id)).toContain(popular);
    expect(topUp.every((food) => food.logCount === 0 && food.lastLoggedAt === null)).toBe(true);
  });

  it("never counts another client's meals, and ignores soft-deleted ones", async () => {
    const coach = await insertCoach();
    const mine = await insertClient(coach.profileId);
    const theirs = await insertClient(coach.profileId);
    const shared = await insertFood({ name: 'Whey Isolate' });
    const deletedOnly = await insertFood({ name: 'Cold Brew' });

    await insertMeal({
      clientId: mine.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-08-01',
      items: [{ foodId: shared }],
    });
    for (const day of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']) {
      await insertMeal({
        clientId: theirs.profileId,
        coachId: coach.profileId,
        loggedDate: day,
        items: [{ foodId: shared }],
      });
    }
    await insertMeal({
      clientId: mine.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-08-02',
      deletedAt: new Date(),
      items: [{ foodId: deletedOnly }],
    });

    const result = await caller(mine.ctx).nutrition.myFoods({ limit: 100 });

    const personal = result.filter((food) => food.ranking === 'personal');
    expect(personal.map((food) => food.id)).toEqual([shared]);
    // Four of the five logs of this food belong to the other client.
    expect(personal[0]?.logCount).toBe(1);
  });

  it('rejects a coach — this is a client-only read', async () => {
    const coach = await insertCoach();

    const cause = await causeOf(caller(coach.ctx).nutrition.myFoods({ limit: 10 }));

    expect(cause.appCode).toBe('ROLE_REQUIRED');
  });

  it('rejects an anonymous caller', async () => {
    const anonymous = createTestContext({ db, user: null });

    const cause = await causeOf(caller(anonymous).nutrition.myFoods({ limit: 10 }));

    expect(cause.appCode).toBe('AUTH_REQUIRED');
  });
});

describe('clientApp.history', () => {
  it('returns sessions in range with their set logs and exercise names', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const exerciseId = await insertExercise('Back Squat');
    const inRange = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-08-10',
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-06-01',
    });
    await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-08-11',
      deletedAt: new Date(),
    });
    await insertSetLog({
      sessionId: inRange,
      clientId: client.profileId,
      exerciseId,
      setNumber: 1,
    });
    await insertSetLog({
      sessionId: inRange,
      clientId: client.profileId,
      exerciseId,
      setNumber: 2,
      deletedAt: new Date(),
    });

    const result = await caller(client.ctx).clientApp.history({
      from: '2026-07-17',
      to: '2026-08-15',
    });

    expect(result.sessions.map((session) => session.id)).toEqual([inRange]);
    expect(result.sessions[0]).toMatchObject({
      scheduledDate: '2026-08-10',
      status: 'completed',
      durationSeconds: 3600,
      perceivedExertion: 8,
      clientNotes: 'Felt strong',
      totalVolumeKg: 5400,
    });
    expect(result.sessions[0]?.setLogs).toEqual([
      expect.objectContaining({
        exerciseId,
        exerciseName: expect.stringContaining('Back Squat'),
        setNumber: 1,
        reps: 5,
        weightKg: 102.5,
        rpe: 8.5,
      }),
    ]);
  });

  it('returns meals with their items, including a quick-add item with no food row', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const foodId = await insertFood({ name: 'Dal' });
    const mealId = await insertMeal({
      clientId: client.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-08-10',
      items: [{ foodId }, { customName: 'Mum’s biryani' }],
    });
    await insertMeal({
      clientId: client.profileId,
      coachId: coach.profileId,
      loggedDate: '2026-05-01',
      items: [{ foodId }],
    });

    const result = await caller(client.ctx).clientApp.history({
      from: '2026-07-17',
      to: '2026-08-15',
    });

    expect(result.meals.map((meal) => meal.id)).toEqual([mealId]);
    expect(result.meals[0]?.items).toHaveLength(2);
    const itemNames = result.meals[0]?.items.map((item) => item.name) ?? [];
    expect(itemNames).toContain('Mum’s biryani');
    expect(itemNames.some((name) => name.startsWith('Dal'))).toBe(true);
    expect(result.meals[0]?.items[0]).toMatchObject({ quantityG: 150, calories: 247.5 });
  });

  it("resolves the comment window through the caller's stored timezone, not UTC", async () => {
    const coach = await insertCoach();
    // 2026-08-14T19:00Z is 00:30 on 2026-08-15 in Kolkata — `CLAUDE.md`
    // §25.5's own example. It belongs to the client's local 15th.
    const kolkata = await insertClient(coach.profileId, 'Asia/Kolkata');
    const utc = await insertClient(coach.profileId, 'UTC');
    const justAfterLocalMidnight = new Date('2026-08-14T19:00:00.000Z');

    for (const client of [kolkata, utc]) {
      const sessionId = await insertSession({
        clientId: client.profileId,
        coachId: coach.profileId,
        scheduledDate: '2026-08-15',
      });
      await insertComment({
        authorUserId: coach.userId,
        clientId: client.profileId,
        targetId: sessionId,
        body: 'Nice depth on set three',
        createdAt: justAfterLocalMidnight,
      });
    }

    const singleDay = { from: '2026-08-15', to: '2026-08-15' } as const;
    const forKolkata = await caller(kolkata.ctx).clientApp.history(singleDay);
    const forUtc = await caller(utc.ctx).clientApp.history(singleDay);

    expect(forKolkata.comments.map((comment) => comment.body)).toEqual(['Nice depth on set three']);
    // Same instant, same calendar range, different zone — still the 14th in UTC.
    expect(forUtc.comments).toEqual([]);
  });

  it('excludes soft-deleted comments and comments about another client', async () => {
    const coach = await insertCoach();
    const mine = await insertClient(coach.profileId);
    const theirs = await insertClient(coach.profileId);
    const createdAt = new Date('2026-08-10T09:00:00.000Z');

    const mySession = await insertSession({
      clientId: mine.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-08-10',
    });
    const theirSession = await insertSession({
      clientId: theirs.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-08-10',
    });
    await insertComment({
      authorUserId: coach.userId,
      clientId: mine.profileId,
      targetId: mySession,
      body: 'Kept for me',
      createdAt,
    });
    await insertComment({
      authorUserId: coach.userId,
      clientId: mine.profileId,
      targetId: mySession,
      body: 'Retracted',
      createdAt,
      deletedAt: new Date(),
    });
    await insertComment({
      authorUserId: coach.userId,
      clientId: theirs.profileId,
      targetId: theirSession,
      body: 'Not mine',
      createdAt,
    });

    const result = await caller(mine.ctx).clientApp.history({
      from: '2026-07-17',
      to: '2026-08-15',
    });

    expect(result.comments.map((comment) => comment.body)).toEqual(['Kept for me']);
    expect(result.sessions.map((session) => session.id)).toEqual([mySession]);
  });

  it('rejects a coach, an anonymous caller, and an inverted range', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const range = { from: '2026-07-17', to: '2026-08-15' } as const;

    expect((await causeOf(caller(coach.ctx).clientApp.history(range))).appCode).toBe(
      'ROLE_REQUIRED',
    );
    expect(
      (await causeOf(caller(createTestContext({ db, user: null })).clientApp.history(range)))
        .appCode,
    ).toBe('AUTH_REQUIRED');
    await expect(
      caller(client.ctx).clientApp.history({ from: '2026-08-15', to: '2026-07-17' }),
    ).rejects.toThrow();
  });
});
