// Real Postgres (`testing` skill §4). `assignment/01`'s own Verification:
// assign a program to a client with no existing assignment — succeeds;
// attempt a second assignment for the same client while the first is still
// active — rejected with `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`, naming the
// conflicting assignment; pause or complete it and the same call succeeds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { addCalendarDays, isoWeekdayOfCalendarDate, toLocalDate } from '@coachos/utils';
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

// `assignment/05` — every client fixture below is `timezone: 'UTC'`
// (`insertClient`), so "today" for the week-advance/completion tests is
// `toLocalDate(new Date(), 'UTC')`. Computed once, at module load, from
// the REAL current date rather than hardcoded — so these tests keep
// passing no matter what day they actually run on, the same reasoning
// `accept-invite.test.ts`'s `tenYearsAgo`/`fifteenYearsAgo` fixtures use.
const today = toLocalDate(new Date(), 'UTC');
const todayWeekday = isoWeekdayOfCalendarDate(today); // 1 (Mon) .. 7 (Sun)
const mondayOfThisWeek = addCalendarDays(today, -(todayWeekday - 1));

/**
 * A `startDate` that is itself a Monday, `weeksAgo` full calendar weeks
 * before the Monday of the week `today` falls in — so "today" always lands
 * in week `weeksAgo + 1` of a program that started there, regardless of
 * which weekday the test happens to run on. The Monday anchor is what
 * makes that true: `daysSinceWeekOneMonday` is always in `[7*weeksAgo,
 * 7*weeksAgo + 6]`, so `floor(daysSinceWeekOneMonday / 7) + 1` is always
 * `weeksAgo + 1` (`../../features/assignments/advance-assignment.ts`'s
 * `computeAssignmentWeekProgress`).
 */
function startDateWeeksAgo(weeksAgo: number): string {
  return addCalendarDays(mondayOfThisWeek, -7 * weeksAgo);
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

    // `today`, not a fixed calendar literal — `assignment/05`'s conflict
    // check now runs the found row through `syncAssignmentProgress`
    // (`../../features/assignments/advance-assignment.ts`), so a hardcoded
    // past date would eventually — and, as of this suite, ALREADY does —
    // read as an expired program and auto-complete before this test's own
    // second `create` call ever gets to see it as a conflict.
    const first = await caller(coach).assignments.create({
      programId: firstProgram.id,
      clientId: client.profileId,
      startDate: today,
    });

    const cause = await causeOf(
      caller(coach).assignments.create({
        programId: secondProgram.id,
        clientId: client.profileId,
        startDate: today,
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
        startDate: today, // see the note in the test above this one
      }),
      createAssignment(db, {
        programId: programB.id,
        clientId: client.profileId,
        coachId: coach.profileId,
        startDate: today,
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
      startDate: today, // see the note on `today` vs. a fixed literal above
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

// `assignment/05` — current_week advance and completion
// (`../../features/assignments/advance-assignment.ts`, decision (a)):
// computed-on-read with a lazy write-back, exercised here through
// `assignments.get`, the one procedure this task adds to actually read a
// single assignment.
describe('assignments.get — current_week advance and completion', () => {
  it('computes current_week from start_date and today, mid-program, and writes the correction back', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Long program', 8);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: startDateWeeksAgo(2), // today falls in week 3 of 8
    });

    const result = await caller(coach).assignments.get({ assignmentId: assignment.id });
    expect(result.currentWeek).toBe(3);
    expect(result.status).toBe('active');
    expect(result.completedAt).toBeNull();

    // The lazy write-back: the STORED column is corrected too, not just
    // the value handed back to this one caller.
    const [row] = await db
      .select({ currentWeek: schema.assignments.currentWeek })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    expect(row?.currentWeek).toBe(3);
  });

  it('caps current_week at duration_weeks while still inside the final week', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Three-week program', 3);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: startDateWeeksAgo(2), // today falls in week 3, the program's last
    });

    const result = await caller(coach).assignments.get({ assignmentId: assignment.id });
    expect(result.currentWeek).toBe(3);
    expect(result.status).toBe('active');
  });

  it('auto-completes once today is past the final week, without manual coach action', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Two-week program', 2);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      // today is in week 3 — one full week past this 2-week program's end.
      startDate: startDateWeeksAgo(2),
    });

    const result = await caller(coach).assignments.get({ assignmentId: assignment.id });
    expect(result.status).toBe('completed');
    expect(result.completedAt).not.toBeNull();
    // Capped at duration_weeks, not left at the raw overshoot value (3).
    expect(result.currentWeek).toBe(2);

    const [row] = await db
      .select({ status: schema.assignments.status, completedAt: schema.assignments.completedAt })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).not.toBeNull();
  });

  it('does not advance or auto-complete a paused assignment', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Paused program', 2);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: startDateWeeksAgo(0),
    });
    await caller(coach).assignments.pause({ assignmentId: assignment.id });

    // Force the row into a state that WOULD both advance the week and
    // trip completion if this were still active — proving the paused
    // branch short-circuits before any of that computation happens.
    await db
      .update(schema.assignments)
      .set({ startDate: startDateWeeksAgo(5), currentWeek: 1 })
      .where(eq(schema.assignments.id, assignment.id));

    const result = await caller(coach).assignments.get({ assignmentId: assignment.id });
    expect(result.status).toBe('paused');
    expect(result.currentWeek).toBe(1);
    expect(result.completedAt).toBeNull();
  });

  it("assigning a new program auto-completes a client's stale-active assignment instead of blocking on it", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const finishedProgram = await insertProgram(coach.profileId, 'Already finished', 2);
    const nextProgram = await insertProgram(coach.profileId, 'The next one', 4);

    const first = await caller(coach).assignments.create({
      programId: finishedProgram.id,
      clientId: client.profileId,
      startDate: startDateWeeksAgo(2), // one week past this 2-week program's end
    });

    // No `assignments.get`, no `assignments.complete` — the first thing to
    // ever touch this stale-active assignment is the new create's own
    // `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT` conflict check.
    const second = await caller(coach).assignments.create({
      programId: nextProgram.id,
      clientId: client.profileId,
      startDate: today,
    });

    const [firstRow] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, first.id));
    expect(firstRow?.status).toBe('completed');

    const [secondRow] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, second.id));
    expect(secondRow?.status).toBe('active');
  });
});

// `assignment/05`'s feature-level acceptance criterion: "week advance and
// completion transitions ... don't orphan scheduled sessions" — decision
// (c), `../../features/assignments/advance-assignment.ts`'s
// `discardOrphanedScheduledSessions`. Soft-deleted (`deleted_at` set,
// `status` left as `'scheduled'`), not flipped to `'skipped'` — that file's
// header comment carries the three reasons; the third test below proves
// the second of them concretely (freeing `sessions_client_day_unique`'s
// slot for a re-assignment).
describe('assignment completion discards orphaned scheduled sessions', () => {
  async function insertProgramWithWeeklyDay(
    coachProfileId: string,
    durationWeeks: number,
  ): Promise<{ id: string }> {
    const program = await insertProgram(coachProfileId, 'Weekly-day program', durationWeeks);
    for (let weekNumber = 1; weekNumber <= durationWeeks; weekNumber += 1) {
      const [week] = await db
        .insert(schema.programWeeks)
        .values({ programId: program.id, weekNumber })
        .returning({ id: schema.programWeeks.id });
      if (!week) throw new Error('seed insert into program_weeks did not return a row');
      await db.insert(schema.programDays).values({
        programWeekId: week.id,
        dayNumber: 1, // Monday
        name: `Week ${weekNumber} day`,
        isRestDay: false,
      });
    }
    return program;
  }

  it('manual completion mid-program soft-deletes every still-scheduled session, past or future', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgramWithWeeklyDay(coach.profileId, 4);

    // Week 1 starts this Monday; weeks 2-4 materialise into the future.
    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: mondayOfThisWeek,
    });

    await caller(coach).assignments.complete({ assignmentId: assignment.id });

    const sessions = await db
      .select({
        status: schema.workoutSessions.status,
        deletedAt: schema.workoutSessions.deletedAt,
      })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, assignment.id));

    expect(sessions).toHaveLength(4);
    // `status` is untouched — still `'scheduled'` — only `deleted_at` marks
    // these as discarded (decision (c), reason 1: a `'skipped'` status
    // would be a false claim about the CLIENT's behaviour).
    expect(sessions.every((s) => s.status === 'scheduled')).toBe(true);
    expect(sessions.every((s) => s.deletedAt !== null)).toBe(true);
  });

  it('auto-completion on read soft-deletes every still-scheduled session left over from the finished program', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgramWithWeeklyDay(coach.profileId, 2);

    const assignment = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      // Both weeks are in the past; today is week 3 — nobody ever started
      // either of these two sessions.
      startDate: startDateWeeksAgo(2),
    });

    await caller(coach).assignments.get({ assignmentId: assignment.id });

    const sessions = await db
      .select({
        status: schema.workoutSessions.status,
        deletedAt: schema.workoutSessions.deletedAt,
      })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, assignment.id));

    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.status === 'scheduled')).toBe(true);
    expect(sessions.every((s) => s.deletedAt !== null)).toBe(true);
  });

  it('reason 2: frees sessions_client_day_unique so re-assigning the same program over the same dates succeeds', async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgramWithWeeklyDay(coach.profileId, 4);

    // First assignment materialises 4 Monday sessions, weeks 1-4, all
    // still `'scheduled'` — none ever started.
    const first = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: mondayOfThisWeek,
    });

    // Completing early, BEFORE any of those Mondays are reached, is
    // exactly the case that would previously have left `'skipped'`,
    // not-deleted rows sitting on `sessions_client_day_unique`'s slot.
    await caller(coach).assignments.complete({ assignmentId: first.id });

    // Re-assigning the SAME program to the SAME client over the SAME
    // start date recomputes the IDENTICAL four `scheduled_date` values
    // (`../../lib/materialise-sessions.ts`'s `calendarDateForProgramDay`
    // is a pure function of `programId`/`startDate`) — under the old
    // `'skipped'`-only behaviour this would abort with a raw 23505 on
    // `sessions_client_day_unique` (that index is partial on
    // `deleted_at IS NULL`, so a merely-`'skipped'` row still occupies it).
    // Soft-deleting frees the slot, so this now succeeds.
    const second = await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: mondayOfThisWeek,
    });

    const secondSessions = await db
      .select({ scheduledDate: schema.workoutSessions.scheduledDate })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, second.id));
    expect(secondSessions).toHaveLength(4);

    // The first assignment's own (now discarded) sessions are untouched by
    // the second's materialisation — still 4, still soft-deleted.
    const firstSessions = await db
      .select({ deletedAt: schema.workoutSessions.deletedAt })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, first.id));
    expect(firstSessions).toHaveLength(4);
    expect(firstSessions.every((s) => s.deletedAt !== null)).toBe(true);
  });
});

// `assignment/05`: the coach's client picker (`../../features/assignments/assignable-clients.ts`)
// shows a correct, live-computed current_week without needing a prior
// `assignments.get` to have touched the row first.
describe('assignments.assignableClients — displays the live-computed current_week', () => {
  it("shows the corrected current_week for a client's active assignment with no prior touch", async () => {
    const coach = await insertCoach();
    const client = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Their program', 8);

    await caller(coach).assignments.create({
      programId: program.id,
      clientId: client.profileId,
      startDate: startDateWeeksAgo(2), // today falls in week 3
    });

    const page = await caller(coach).assignments.assignableClients({ limit: 20 });
    const item = page.items.find((entry) => entry.id === client.profileId);
    expect(item?.activeAssignment?.currentWeek).toBe(3);

    // Display-only — the stored column is untouched until something else
    // reads this specific assignment (`assignments.get`, or a future
    // `assignments.create` conflict check).
    const [row] = await db
      .select({ currentWeek: schema.assignments.currentWeek })
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, client.profileId));
    expect(row?.currentWeek).toBe(1);
  });
});
