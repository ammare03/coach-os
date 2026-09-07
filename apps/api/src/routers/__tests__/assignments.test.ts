// Real Postgres (`testing` skill §4). `assignment/01`'s own Verification:
// assign a program to a client with no existing assignment — succeeds;
// attempt a second assignment for the same client while the first is still
// active — rejected with `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`, naming the
// conflicting assignment; pause or complete it and the same call succeeds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { createAssignment } from '../../features/assignments/create-assignment.ts';
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

interface Coach {
  profileId: string;
  ctx: Context;
}

interface ClientProfileFixture {
  profileId: string;
}

async function insertCoach(): Promise<Coach> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `coach-${seq}@assignments-test.com`,
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

async function insertClient(
  coachProfileId: string,
  overrides: Partial<typeof schema.clientProfiles.$inferInsert> = {},
): Promise<ClientProfileFixture> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@assignments-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone: 'UTC',
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  return { profileId: profile.id };
}

async function insertProgram(
  coachProfileId: string,
  name = 'Fixture Program',
  durationWeeks = 8,
): Promise<{ id: string }> {
  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: coachProfileId, name, durationWeeks })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');
  return { id: program.id };
}

function caller(coach: Coach) {
  return appRouter.createCaller(coach.ctx);
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

describe('assignments.create', () => {
  it('assigns a program to a client with no existing assignment, live-referencing the program', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId);

    const result = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: '2026-08-10',
    });

    const [row] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, result.id));
    expect(row).toMatchObject({
      // Live-reference, not a snapshot copy (`assignment/00`'s resolution)
      // — the row points directly at the same program row.
      programId: program.id,
      clientId: client.profileId,
      coachId: coach.profileId,
      startDate: '2026-08-10',
      currentWeek: 1,
      status: 'active',
    });
  });

  it('rejects a second active assignment with CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT, naming the existing one', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const firstProgram = await insertProgram(coach.profileId, 'First program', 6);
    const secondProgram = await insertProgram(coach.profileId, 'Second program', 4);

    const first = await caller(coach).assignments.create({
      programId: firstProgram.id,
      clientId: client.profileId,
      startDate: '2026-08-01',
    });

    const cause = await causeOf(
      caller(coach).assignments.create({
        programId: secondProgram.id,
        clientId: client.profileId,
        startDate: '2026-08-15',
      }),
    );

    expect(cause.appCode).toBe('CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT');
    expect(cause.details).toEqual({
      assignmentId: first.id,
      programName: 'First program',
      currentWeek: 1,
      durationWeeks: 6,
    });

    // Refused, not silently accepted — only the first assignment exists.
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, client.profileId));
    expect(rows).toHaveLength(1);
  });

  it('the insert-time unique violation is the second line of defence for a genuine race', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const programA = await insertProgram(coach.profileId, 'Race A', 4);
    const programB = await insertProgram(coach.profileId, 'Race B', 4);

    // Two concurrent creates for the same client, neither of which sees the
    // other in its own pre-check `SELECT` — `assignments_one_active` is
    // what actually decides the winner; the loser's raw `23505` must still
    // come back as the same catalogued, richly-payloaded error, never a
    // bare `UNKNOWN_CONFLICT` or an unhandled crash.
    const results = await Promise.allSettled([
      createAssignment(db, {
        programId: programA.id,
        clientId: client.profileId,
        coachId: coach.profileId,
        startDate: '2026-08-01',
      }),
      createAssignment(db, {
        programId: programB.id,
        clientId: client.profileId,
        coachId: coach.profileId,
        startDate: '2026-08-01',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0];
    if (rejection?.status !== 'rejected') throw new Error('expected a rejection');
    expect(rejection.reason).toBeInstanceOf(TRPCError);
    const error = rejection.reason as TRPCError;
    expect(isCatalogedError(error) && error.cause.appCode).toBe(
      'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT',
    );

    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, client.profileId));
    expect(rows).toHaveLength(1);
  });

  it('pausing the existing assignment frees the client for a new one', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const firstProgram = await insertProgram(coach.profileId, 'To be paused', 4);
    const secondProgram = await insertProgram(coach.profileId, 'The new one', 4);

    const first = await caller(coach).assignments.create({
      programId: firstProgram.id,
      clientId: client.profileId,
      startDate: '2026-08-01',
    });

    await caller(coach).assignments.pause({ assignmentId: first.id });

    const second = await caller(coach).assignments.create({
      programId: secondProgram.id,
      clientId: client.profileId,
      startDate: '2026-08-20',
    });

    const [pausedRow] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, first.id));
    expect(pausedRow?.status).toBe('paused');

    const [activeRow] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, second.id));
    expect(activeRow?.status).toBe('active');
  });

  it('completing the existing assignment frees the client for a new one and stamps completedAt', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const firstProgram = await insertProgram(coach.profileId, 'To be completed', 4);
    const secondProgram = await insertProgram(coach.profileId, 'The new one', 4);

    const first = await caller(coach).assignments.create({
      programId: firstProgram.id,
      clientId: client.profileId,
      startDate: '2026-08-01',
    });

    await caller(coach).assignments.complete({ assignmentId: first.id });

    await caller(coach).assignments.create({
      programId: secondProgram.id,
      clientId: client.profileId,
      startDate: '2026-08-20',
    });

    const [row] = await db
      .select({ status: schema.assignments.status, completedAt: schema.assignments.completedAt })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, first.id));
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).not.toBeNull();
  });

  it('refuses a program another coach owns, and changes nothing', async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId);

    const cause = await causeOf(
      caller(attacker).assignments.create({
        programId: program.id,
        clientId: client.profileId,
        startDate: '2026-08-01',
      }),
    );
    expect(cause.appCode).toBe('NOT_YOUR_CLIENT');

    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.programId, program.id));
    expect(rows).toHaveLength(0);
  });

  it('refuses a client another coach owns, and changes nothing', async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const client = await insertClient(coach.profileId);
    const attackerProgram = await insertProgram(attacker.profileId);

    const cause = await causeOf(
      caller(attacker).assignments.create({
        programId: attackerProgram.id,
        clientId: client.profileId,
        startDate: '2026-08-01',
      }),
    );
    expect(cause.appCode).toBe('NOT_YOUR_CLIENT');

    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, client.profileId));
    expect(rows).toHaveLength(0);
  });
});

describe('assignments.pause / assignments.complete', () => {
  it("refuses another coach's assignment with NOT_YOUR_CLIENT, and changes nothing", async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: '2026-08-01',
    });

    const pauseCause = await causeOf(
      caller(attacker).assignments.pause({ assignmentId: assignment.id }),
    );
    expect(pauseCause.appCode).toBe('NOT_YOUR_CLIENT');

    const completeCause = await causeOf(
      caller(attacker).assignments.complete({ assignmentId: assignment.id }),
    );
    expect(completeCause.appCode).toBe('NOT_YOUR_CLIENT');

    const [row] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    expect(row?.status).toBe('active');
  });
});

describe('assignments.assignableClients', () => {
  it('lists active/paused clients with their current active assignment, and excludes invited/archived ones', async () => {
    const coach = await insertCoach();
    const withProgram = await insertClient(coach.profileId);
    const withoutProgram = await insertClient(coach.profileId);
    const paused = await insertClient(coach.profileId, { status: 'paused' });
    await insertClient(coach.profileId, { status: 'invited', activatedAt: null });
    await insertClient(coach.profileId, {
      status: 'archived',
      activatedAt: new Date(),
      archivedAt: new Date(),
    });

    const program = await insertProgram(coach.profileId, 'Their program', 10);
    await caller(coach).assignments.create({
      programId: program.id,
      clientId: withProgram.profileId,
      startDate: '2026-08-01',
    });

    const page = await caller(coach).assignments.assignableClients({ limit: 20 });
    const byId = new Map(page.items.map((item) => [item.id, item]));

    expect(byId.size).toBe(3);
    expect(byId.get(withProgram.profileId)?.activeAssignment).toMatchObject({
      programName: 'Their program',
      currentWeek: 1,
      durationWeeks: 10,
    });
    expect(byId.get(withoutProgram.profileId)?.activeAssignment).toBeNull();
    expect(byId.get(paused.profileId)?.status).toBe('paused');
  });

  it("never returns another coach's clients", async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    await insertClient(attacker.profileId);

    const page = await caller(coach).assignments.assignableClients({ limit: 20 });
    expect(page.items).toHaveLength(0);
  });
});

// `assignment/03` — `assignments.create` now also materialises
// `workout_sessions` (`../../lib/materialise-sessions.ts` owns the
// date-boundary rigor and decisions (a)-(e); this suite only checks the
// wiring: that `create` actually calls it, inside the same transaction as
// the assignment insert).
describe('assignments.create — session materialisation wiring', () => {
  async function insertProgramWithOneDay(
    coachProfileId: string,
    dayNumber: number,
  ): Promise<{ id: string }> {
    const program = await insertProgram(coachProfileId, 'Materialised program', 1);
    const [week] = await db
      .insert(schema.programWeeks)
      .values({ programId: program.id, weekNumber: 1 })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('seed insert into program_weeks did not return a row');
    await db.insert(schema.programDays).values({
      programWeekId: week.id,
      dayNumber,
      name: 'Day 1',
      isRestDay: false,
    });
    return program;
  }

  it('materialises a scheduled session for the assigned client on assignments.create', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgramWithOneDay(coach.profileId, 1); // Monday

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: '2026-08-10', // a Monday
    });

    const sessions = await db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, assignment.id));

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      clientId: client.profileId,
      coachId: coach.profileId,
      scheduledDate: '2026-08-10',
      status: 'scheduled',
      totalVolumeKg: null,
      programSnapshot: null,
    });
    expect(sessions[0]?.clientLocalId).not.toBeNull();
  });

  it('rolls back the assignment row too if materialisation fails', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgramWithOneDay(coach.profileId, 1); // Monday

    // Pre-seed a conflicting workout_sessions row so materialisation's own
    // insert collides with `sessions_client_day_unique`.
    const [day] = await db
      .select({ id: schema.programDays.id })
      .from(schema.programDays)
      .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
      .where(eq(schema.programWeeks.programId, program.id));
    if (!day) throw new Error('fixture day missing');
    await db.insert(schema.workoutSessions).values({
      clientId: client.profileId,
      coachId: coach.profileId,
      programDayId: day.id,
      scheduledDate: '2026-08-10',
      status: 'scheduled',
    });

    await expect(
      caller(coach).assignments.create({
        programId: program.id,
        clientId: client.profileId,
        startDate: '2026-08-10',
      }),
    ).rejects.toThrow();

    // The assignment itself never committed either — atomicity across both
    // writes, not just across the sessions batch.
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, client.profileId));
    expect(rows).toHaveLength(0);
  });
});
