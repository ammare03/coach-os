// Real Postgres (`testing` skill §4). Every guarantee here is a property of
// a statement — which column the start UPDATE writes, what the completion
// UPDATE clears, what a coach-scoped read is able to return — and none of
// them survives a mock.
//
// `phase-09-workout-logger/session-runtime/09`'s Verification, minus the
// parts that need two devices: a client starts Tuesday and logs; the coach
// edits Tuesday and saves; the client's remaining prescription does not
// move; the coach is warned, by name; completion clears the snapshot and
// the NEXT session reflects every edit.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

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

interface Actor {
  profileId: string;
  ctx: Context;
}

async function insertCoach(): Promise<Actor> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@snapshot-test.com`,
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

async function insertClient(coachProfileId: string | null, name?: string): Promise<Actor> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@snapshot-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: name ?? `Client ${seq}`,
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
    deletedAt: null,
  };
  return { profileId: profile.id, ctx: createTestContext({ db, user: contextUser }) };
}

async function insertExercise(): Promise<string> {
  seq += 1;
  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Back squat ${seq}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
      cues: ['Brace hard'],
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');
  return exercise.id;
}

interface DayFixture {
  programId: string;
  dayId: string;
  blockId: string;
  exerciseId: string;
}

/** A one-day program whose single day carries one prescribed block. */
async function insertProgramDay(coachProfileId: string): Promise<DayFixture> {
  seq += 1;
  const exerciseId = await insertExercise();
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
    .values({ programWeekId: week.id, dayNumber: 1, name: 'Upper A' })
    .returning({ id: schema.programDays.id });
  if (!day) throw new Error('seed insert into program_days did not return a row');
  const [block] = await db
    .insert(schema.programExercises)
    .values({
      programDayId: day.id,
      exerciseId,
      orderIndex: 1,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRpe: '8.0',
      targetWeightKg: '60.00',
      targetRestSeconds: 120,
      alternatives: [],
    })
    .returning({ id: schema.programExercises.id });
  if (!block) throw new Error('seed insert into program_exercises did not return a row');

  return { programId: program.id, dayId: day.id, blockId: block.id, exerciseId };
}

async function insertSession(args: {
  clientId: string;
  coachId: string;
  programDayId: string | null;
  scheduledDate: string;
}): Promise<{ id: string; clientLocalId: string }> {
  const clientLocalId = uuidv7();
  const [session] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: args.clientId,
      coachId: args.coachId,
      programDayId: args.programDayId,
      scheduledDate: args.scheduledDate,
      status: 'scheduled',
      clientLocalId,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!session) throw new Error('seed insert into workout_sessions did not return a row');
  return { id: session.id, clientLocalId };
}

function caller(ctx: Context) {
  return appRouter.createCaller(ctx);
}

/** The catalogued `cause.appCode` of a call that must reject (`api-conventions` §5). */
async function appCodeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof TRPCError && isCatalogedError(error)) return error.cause.appCode;
    throw error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

async function rowOf(sessionId: string) {
  const [row] = await db
    .select()
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row;
}

/** What `workouts.upcoming` says about one session on one date. */
async function readSession(client: Actor, sessionId: string, date: string) {
  const result = await caller(client.ctx).workouts.upcoming({ from: date, to: date });
  return result.sessions.find((session) => session.id === sessionId);
}

const DAY = '2026-08-18';
const NEXT_DAY = '2026-08-25';
const STARTED_AT = new Date('2026-08-18T18:03:00.000Z');

describe('program snapshot — the write', () => {
  it('is written at started_at, never at creation', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    // Materialised and untouched: nothing is frozen yet, because nothing
    // has begun and there is nothing to protect.
    expect((await rowOf(session.id))?.programSnapshot).toBeNull();

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });

    expect((await rowOf(session.id))?.programSnapshot).toEqual({
      version: 1,
      exercises: [
        expect.objectContaining({
          programExerciseId: day.blockId,
          exerciseId: day.exerciseId,
          targetSets: 3,
          // Numbers, not the strings Drizzle hands back for `numeric`.
          targetRpe: 8,
          targetWeightKg: 60,
        }),
      ],
    });
  });

  it('freezes a session with no program day as nothing, not as an empty plan', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: null,
      scheduledDate: DAY,
    });

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });

    expect((await rowOf(session.id))?.programSnapshot).toBeNull();
  });

  it('does not re-freeze on a replayed start', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });
    const sent = { workoutSessionId: session.id, clientLocalId: uuidv7(), startedAt: STARTED_AT };

    await caller(client.ctx).workouts.start(sent);
    // The coach edits, then an hour-old outbox entry finally reaches the
    // network. The replay must not overwrite what the client is inside.
    await caller(coach.ctx).programs.exercises.update({
      programExerciseId: day.blockId,
      targetSets: 5,
    });
    await caller(client.ctx).workouts.start(sent);

    const snapshot = (await rowOf(session.id))?.programSnapshot as {
      exercises: { targetSets: number }[];
    };
    expect(snapshot.exercises[0]?.targetSets).toBe(3);
  });
});

describe('program snapshot — what the client sees', () => {
  it('serves the frozen prescription beside the live one, and a mid-session edit moves only the live one', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });
    // 18:04: the coach changes the set count and the target weight.
    await caller(coach.ctx).programs.exercises.update({
      programExerciseId: day.blockId,
      targetSets: 5,
      targetWeightKg: 80,
    });

    const served = await readSession(client, session.id, DAY);

    expect(served?.status).toBe('in_progress');
    // The live field moved, as it must — a scheduled session reads it.
    expect(served?.exercises[0]?.targetSets).toBe(5);
    expect(served?.exercises[0]?.targetWeightKg).toBe(80);
    // The frozen one did not. This is the whole feature.
    expect(served?.programSnapshot?.[0]?.targetSets).toBe(3);
    expect(served?.programSnapshot?.[0]?.targetWeightKg).toBe(60);
  });

  it('names an exercise the coach removed mid-session, so the page a client is on keeps its title', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });
    await caller(coach.ctx).programs.exercises.delete({ programExerciseId: day.blockId });

    const result = await caller(client.ctx).workouts.upcoming({ from: DAY, to: DAY });
    const served = result.sessions.find((s) => s.id === session.id);

    expect(served?.exercises).toEqual([]);
    expect(served?.programSnapshot).toHaveLength(1);
    // The library row the frozen block points at still crosses the wire,
    // even though no live block mentions it any more.
    expect(result.exercises.map((exercise) => exercise.id)).toContain(day.exerciseId);
  });

  it('leaves a scheduled-but-not-started session picking up the edit normally', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    await caller(coach.ctx).programs.exercises.update({
      programExerciseId: day.blockId,
      targetSets: 5,
    });

    const served = await readSession(client, session.id, DAY);

    expect(served?.status).toBe('scheduled');
    expect(served?.programSnapshot).toBeNull();
    expect(served?.exercises[0]?.targetSets).toBe(5);
  });
});

describe('program snapshot — completion', () => {
  it('is cleared in the completion transaction, and the next session reflects every edit', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });
    const next = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: NEXT_DAY,
    });

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });
    await caller(coach.ctx).programs.exercises.update({
      programExerciseId: day.blockId,
      targetSets: 5,
    });
    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.clientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-18T19:05:00.000Z'),
    });

    expect((await rowOf(session.id))?.programSnapshot).toBeNull();
    expect((await readSession(client, session.id, DAY))?.programSnapshot).toBeNull();

    // Next Tuesday: nothing is frozen, so the edit is simply what the
    // client is shown.
    const following = await readSession(client, next.id, NEXT_DAY);
    expect(following?.exercises[0]?.targetSets).toBe(5);
  });
});

describe('programs.days.midSessionClients — the coach-side warning', () => {
  it('names the client who is inside the day right now', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId, 'Priya N');
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });

    const warned = await caller(coach.ctx).programs.days.midSessionClients({
      programDayId: day.dayId,
    });

    expect(warned).toEqual([
      { clientId: client.profileId, name: 'Priya N', startedAt: STARTED_AT },
    ]);
  });

  it('is empty before a start and again after a completion — nobody is blocked either way', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });

    expect(
      await caller(coach.ctx).programs.days.midSessionClients({ programDayId: day.dayId }),
    ).toEqual([]);

    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });
    // The coach's edit saves normally while the client is inside it.
    await caller(coach.ctx).programs.exercises.update({
      programExerciseId: day.blockId,
      targetSets: 5,
    });
    expect(
      await caller(coach.ctx).programs.days.midSessionClients({ programDayId: day.dayId }),
    ).toHaveLength(1);

    await caller(client.ctx).workouts.complete({
      sessionClientLocalId: session.clientLocalId,
      clientLocalId: uuidv7(),
      completedAt: new Date('2026-08-18T19:05:00.000Z'),
    });
    expect(
      await caller(coach.ctx).programs.days.midSessionClients({ programDayId: day.dayId }),
    ).toEqual([]);
  });

  it('orders by who started first', async () => {
    const coach = await insertCoach();
    const first = await insertClient(coach.profileId, 'Arjun K');
    const second = await insertClient(coach.profileId, 'Meera R');
    const day = await insertProgramDay(coach.profileId);

    for (const [actor, at] of [
      [second, new Date('2026-08-18T18:30:00.000Z')],
      [first, new Date('2026-08-18T18:00:00.000Z')],
    ] as const) {
      const session = await insertSession({
        clientId: actor.profileId,
        coachId: coach.profileId,
        programDayId: day.dayId,
        scheduledDate: DAY,
      });
      await caller(actor.ctx).workouts.start({
        workoutSessionId: session.id,
        clientLocalId: uuidv7(),
        startedAt: at,
      });
    }

    const warned = await caller(coach.ctx).programs.days.midSessionClients({
      programDayId: day.dayId,
    });

    expect(warned.map((row) => row.name)).toEqual(['Arjun K', 'Meera R']);
  });

  it("refuses another coach's day", async () => {
    const coach = await insertCoach();
    const other = await insertCoach();
    const day = await insertProgramDay(coach.profileId);

    expect(
      await appCodeOf(
        caller(other.ctx).programs.days.midSessionClients({ programDayId: day.dayId }),
      ),
    ).toBe('NOT_YOUR_CLIENT');
  });

  it('does not name a client who has left this coach', async () => {
    // `account-lifecycle/06` nulls `workout_sessions.coach_id` on detach.
    // The coach still owns the program day; the person is no longer theirs
    // to name (`mid-session-clients.ts` decision (b)).
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const day = await insertProgramDay(coach.profileId);
    const session = await insertSession({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.dayId,
      scheduledDate: DAY,
    });
    await caller(client.ctx).workouts.start({
      workoutSessionId: session.id,
      clientLocalId: uuidv7(),
      startedAt: STARTED_AT,
    });

    await db.transaction(async (tx) => {
      // The owner-change guard trigger (migrations/0022) refuses this
      // outside a transaction that has opted in — the same escape hatch
      // `services/coach-client-transition.ts` uses.
      await tx.execute(sql`SET LOCAL app.allow_owner_change = true`);
      await tx
        .update(schema.workoutSessions)
        .set({ coachId: null })
        .where(eq(schema.workoutSessions.id, session.id));
    });

    expect(
      await caller(coach.ctx).programs.days.midSessionClients({ programDayId: day.dayId }),
    ).toEqual([]);
  });
});
