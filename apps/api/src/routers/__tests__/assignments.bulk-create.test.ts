// Real Postgres (`testing` skill §4). `assignment/02`'s own Verification:
// bulk-assign to a mix of clients with and without existing active
// assignments, confirm the succeeded/conflicted split is correct — plus
// the authorization case this task calls out by name: a batch containing
// one foreign client id must be refused outright, and the non-conflict
// error path must not be silently folded into `conflicted`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { toLocalDate } from '@coachos/utils';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
import { bulkCreateAssignments } from '../../features/assignments/bulk-create-assignments.ts';
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
      email: `coach-${seq}@assignments-bulk-test.com`,
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

async function insertClient(coachProfileId: string): Promise<ClientProfileFixture> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@assignments-bulk-test.com`,
      passwordHash: 'argon2id$placeholder',
      name: `Client ${seq}`,
      role: 'client',
      timezone: 'UTC',
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, coachId: coachProfileId, status: 'active', activatedAt: new Date() })
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

// Every client fixture is `timezone: 'UTC'` (`insertClient`), so "today" for
// the conflict test below is `toLocalDate(new Date(), 'UTC')` — computed
// from the real current date rather than a fixed calendar literal, the same
// reasoning `assignments.test.ts`'s own `today` constant documents:
// `assignments.create`'s conflict check now runs the found row through
// `syncAssignmentProgress`, so a hardcoded past date eventually (and, by the
// time this suite runs, already does) reads as an expired program and
// auto-completes before the bulk call ever sees it as a conflict.
const today = toLocalDate(new Date(), 'UTC');

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

describe('assignments.bulkCreate', () => {
  it('assigns every client with no existing assignment, in one call', async () => {
    const coach = await insertCoach();
    const clientA = await insertClient(coach.profileId);
    const clientB = await insertClient(coach.profileId);
    const clientC = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Bulk program', 6);

    const result = await caller(coach).assignments.bulkCreate({
      programId: program.id,
      clientIds: [clientA.profileId, clientB.profileId, clientC.profileId],
      startDate: '2026-08-10',
    });

    expect(result.conflicted).toEqual([]);
    expect(result.succeeded).toHaveLength(3);
    expect(new Set(result.succeeded.map((s) => s.clientId))).toEqual(
      new Set([clientA.profileId, clientB.profileId, clientC.profileId]),
    );

    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.programId, program.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'active')).toBe(true);
  });

  it("one client's existing active assignment doesn't block the others — the whole point of this task", async () => {
    const coach = await insertCoach();
    const clientNoProgram1 = await insertClient(coach.profileId);
    const clientAlreadyAssigned = await insertClient(coach.profileId);
    const clientNoProgram2 = await insertClient(coach.profileId);
    const existingProgram = await insertProgram(coach.profileId, 'Existing', 4);
    const bulkProgram = await insertProgram(coach.profileId, 'Bulk target', 6);

    const existing = await caller(coach).assignments.create({
      programId: existingProgram.id,
      clientId: clientAlreadyAssigned.profileId,
      startDate: today,
    });

    const result = await caller(coach).assignments.bulkCreate({
      programId: bulkProgram.id,
      clientIds: [
        clientNoProgram1.profileId,
        clientAlreadyAssigned.profileId,
        clientNoProgram2.profileId,
      ],
      startDate: today,
    });

    expect(result.succeeded).toHaveLength(2);
    expect(new Set(result.succeeded.map((s) => s.clientId))).toEqual(
      new Set([clientNoProgram1.profileId, clientNoProgram2.profileId]),
    );

    expect(result.conflicted).toEqual([
      {
        clientId: clientAlreadyAssigned.profileId,
        assignmentId: existing.id,
        programName: 'Existing',
        currentWeek: 1,
        durationWeeks: 4,
      },
    ]);

    // The two successful clients are genuinely assigned to the NEW program.
    const succeededRows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.programId, bulkProgram.id));
    expect(succeededRows).toHaveLength(2);

    // The conflicted client was never touched — still on the original program.
    const [conflictedRow] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, clientAlreadyAssigned.profileId));
    expect(conflictedRow?.programId).toBe(existingProgram.id);
  });

  it('refuses the whole batch if one client id belongs to another coach, and writes nothing', async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const ownClient1 = await insertClient(coach.profileId);
    const foreignClient = await insertClient(attacker.profileId);
    const ownClient2 = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Guarded program', 6);

    const cause = await causeOf(
      caller(coach).assignments.bulkCreate({
        programId: program.id,
        clientIds: [ownClient1.profileId, foreignClient.profileId, ownClient2.profileId],
        startDate: '2026-08-10',
      }),
    );
    expect(cause.appCode).toBe('NOT_YOUR_CLIENT');

    // Partial ownership is total failure — NEITHER of the coach's own two
    // clients was assigned either, even though both ids were legitimately
    // theirs (`ownsResource`'s own contract: all-or-nothing over an array).
    const rows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.programId, program.id));
    expect(rows).toHaveLength(0);
  });

  it('refuses the whole batch for a program owned by another coach', async () => {
    const coach = await insertCoach();
    const attacker = await insertCoach();
    const client = await insertClient(coach.profileId);
    const foreignProgram = await insertProgram(attacker.profileId);

    const cause = await causeOf(
      caller(coach).assignments.bulkCreate({
        programId: foreignProgram.id,
        clientIds: [client.profileId],
        startDate: '2026-08-10',
      }),
    );
    expect(cause.appCode).toBe('NOT_YOUR_CLIENT');
  });

  it('an unexpected, non-conflict error mid-batch is not folded into conflicted — it aborts the batch and keeps what already succeeded', async () => {
    const coach = await insertCoach();
    const clientA = await insertClient(coach.profileId);
    const clientB = await insertClient(coach.profileId);
    const program = await insertProgram(coach.profileId, 'Partial failure program', 4);

    // `clientB` is pre-seeded with a row that will collide with
    // materialisation's own insert (the same technique
    // `assignments.test.ts`'s "rolls back the assignment row too if
    // materialisation fails" case uses) — a genuine, unexpected failure
    // that is NOT `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`.
    const [week] = await db
      .insert(schema.programWeeks)
      .values({ programId: program.id, weekNumber: 1 })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('seed insert into program_weeks did not return a row');
    const [day] = await db
      .insert(schema.programDays)
      .values({ programWeekId: week.id, dayNumber: 1, name: 'Day 1', isRestDay: false })
      .returning({ id: schema.programDays.id });
    if (!day) throw new Error('seed insert into program_days did not return a row');
    await db.insert(schema.workoutSessions).values({
      clientId: clientB.profileId,
      coachId: coach.profileId,
      programDayId: day.id,
      scheduledDate: '2026-08-10', // a Monday — matches the bulk call's own startDate below
      status: 'scheduled',
    });

    await expect(
      bulkCreateAssignments(db, {
        programId: program.id,
        clientIds: [clientA.profileId, clientB.profileId],
        coachId: coach.profileId,
        startDate: '2026-08-10',
      }),
    ).rejects.toThrow();

    // `clientA`, processed before the failure, kept its own committed
    // transaction — the bug on client B did not undo it.
    const [clientARow] = await db
      .select({ status: schema.assignments.status })
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, clientA.profileId));
    expect(clientARow?.status).toBe('active');

    // `clientB` never got an assignment row — the failure was rethrown,
    // never silently written down as a "conflict".
    const clientBRows = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.clientId, clientB.profileId));
    expect(clientBRows).toHaveLength(0);
  });
});
