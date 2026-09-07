// `assignment/04-bulk-edit.md` — an audit-and-prove task, not a feature
// task. §8.4 promises "bulk edit: change an exercise across all clients on
// a program." Under live-reference (`../../features/programs/versioning.md`)
// that capability requires no new procedure and no per-assignment fan-out —
// it requires proof that a single `programs.exercises.update` call (task
// 00/`program-builder/02`'s existing procedure) is immediately visible to
// every currently-assigned client's upcoming session, and that it never
// touches a `workout_sessions` row directly (`../../lib/
// materialise-sessions.ts`'s decision (c): materialisation writes a SHELL,
// no target value, ever). This suite proves both directions: the positive
// (propagation reaches every assignment) and the negative (a completed
// session's history — its `set_logs` and its frozen `program_snapshot` —
// is untouched by a later edit). Real Postgres (`testing` skill §4).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createTestContext } from '../../__tests__/test-context.ts';
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
      email: `coach-${seq}@bulk-edit-test.com`,
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

async function insertClient(coachProfileId: string): Promise<{ profileId: string }> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `client-${seq}@bulk-edit-test.com`,
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

async function insertExercise(): Promise<{ id: string }> {
  seq += 1;
  const [row] = await db
    .insert(schema.exercises)
    .values({
      name: `Bulk edit fixture exercise ${seq}`,
      primaryMuscle: 'chest',
      equipment: 'barbell',
      movementPattern: 'push',
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return { id: row.id };
}

/**
 * A coach-owned program with exactly one week, one non-rest day (day_number
 * 1 = Monday), and one `program_exercises` block on it at `targetSets`. The
 * minimal shape this suite's scenario needs: one exercise a coach can bulk-
 * edit, on one day every assigned client's session materialises against.
 */
async function insertProgramWithExercise(
  coachProfileId: string,
  targetSets: number,
): Promise<{ programId: string; programDayId: string; programExerciseId: string }> {
  seq += 1;
  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: coachProfileId, name: `Bulk edit program ${seq}`, durationWeeks: 1 })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

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

  const exercise = await insertExercise();
  const [programExercise] = await db
    .insert(schema.programExercises)
    .values({
      programDayId: day.id,
      exerciseId: exercise.id,
      orderIndex: 1,
      targetSets,
    })
    .returning({ id: schema.programExercises.id });
  if (!programExercise) throw new Error('seed insert into program_exercises did not return a row');

  return { programId: program.id, programDayId: day.id, programExerciseId: programExercise.id };
}

function caller(coach: Coach) {
  return appRouter.createCaller(coach.ctx);
}

/**
 * The live target for a program day's one exercise block, read exactly the
 * way an upcoming session's target line resolves it: joined through
 * `program_day_id` into `program_exercises`, never read off `workout_sessions`
 * itself — which stores no target column at all (`../../lib/
 * materialise-sessions.ts` decision (c); `packages/db/src/schema/
 * training.ts`'s `workoutSessions` table has no `target_*` column to read).
 */
async function liveTargetSetsForDay(programDayId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ targetSets: schema.programExercises.targetSets })
    .from(schema.programExercises)
    .where(eq(schema.programExercises.programDayId, programDayId))
    .limit(1);
  return row?.targetSets;
}

describe('bulk edit propagates live to every assigned client (assignment/04)', () => {
  it(
    "editing a program_exercises row's targets through the EXISTING " +
      'programs.exercises.update procedure is immediately visible to every ' +
      "currently-assigned client's upcoming session, bumps programs.version, " +
      'and never touches workout_sessions',
    async () => {
      const coach = await insertCoach();
      const { programId, programDayId, programExerciseId } = await insertProgramWithExercise(
        coach.profileId,
        3,
      );

      const clients = [
        await insertClient(coach.profileId),
        await insertClient(coach.profileId),
        await insertClient(coach.profileId),
      ];

      const assignments = [];
      for (const client of clients) {
        // '2026-08-10' is a Monday — the program's only day (day_number 1)
        // materialises exactly one session for each client.
        const assignment = await caller(coach).assignments.create({
          programId,
          clientId: client.profileId,
          startDate: '2026-08-10',
        });
        assignments.push(assignment);
      }

      const sessionsBefore = [];
      for (const assignment of assignments) {
        const rows = await db
          .select()
          .from(schema.workoutSessions)
          .where(eq(schema.workoutSessions.assignmentId, assignment.id));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('scheduled');
        sessionsBefore.push(rows[0]);
      }
      expect(await liveTargetSetsForDay(programDayId)).toBe(3);

      const [programBefore] = await db
        .select({ version: schema.programs.version })
        .from(schema.programs)
        .where(eq(schema.programs.id, programId));
      expect(programBefore?.version).toBe(1);

      // THE bulk edit — one call, against the one program row every
      // assignment already points at. Never per-client, never per-assignment.
      await caller(coach).programs.exercises.update({ programExerciseId, targetSets: 5 });

      // task 00's change counter bumps once for this structural edit
      // (`../../features/programs/versioning.md`).
      const [programAfter] = await db
        .select({ version: schema.programs.version })
        .from(schema.programs)
        .where(eq(schema.programs.id, programId));
      expect(programAfter?.version).toBe(2);

      // Every client's upcoming session resolves the NEW target live,
      // through program_day_id — proving propagation reached all three
      // without a second write anywhere.
      expect(await liveTargetSetsForDay(programDayId)).toBe(5);

      // And `workout_sessions` itself was never written to by the edit — the
      // rows are byte-identical (including `updated_at`) before and after.
      // This is the concrete proof of materialise-sessions.ts's decision
      // (c): nothing copies a target value onto a session, so there is
      // nothing here for the edit to have gone stale against.
      for (const [index, assignment] of assignments.entries()) {
        const rows = await db
          .select()
          .from(schema.workoutSessions)
          .where(eq(schema.workoutSessions.assignmentId, assignment.id));
        expect(rows).toEqual([sessionsBefore[index]]);
      }
    },
  );
});

describe("a completed session's history stays frozen under a later bulk edit (assignment/04)", () => {
  it('does not change set_logs or the frozen program_snapshot of an already-completed session', async () => {
    const coach = await insertCoach();
    const { programId, programDayId, programExerciseId } = await insertProgramWithExercise(
      coach.profileId,
      3,
    );
    const client = await insertClient(coach.profileId);

    const assignment = await caller(coach).assignments.create({
      programId,
      clientId: client.profileId,
      startDate: '2026-08-10', // a Monday
    });

    const [session] = await db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.assignmentId, assignment.id));
    if (!session) throw new Error('fixture session missing');

    const [exerciseRow] = await db
      .select({ exerciseId: schema.programExercises.exerciseId })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.id, programExerciseId));
    if (!exerciseRow) throw new Error('fixture program exercise missing');

    // Simulates what `phase-09-workout-logger`'s Start action will do:
    // freeze DB§14.6's `program_snapshot` at the target as it stood when the
    // client started, then complete the session and log a set against that
    // same, now-historical target.
    const frozenSnapshot = { targetSets: 3 };
    await db
      .update(schema.workoutSessions)
      .set({
        status: 'completed',
        startedAt: new Date('2026-08-10T10:00:00Z'),
        completedAt: new Date('2026-08-10T10:30:00Z'),
        programSnapshot: frozenSnapshot,
      })
      .where(eq(schema.workoutSessions.id, session.id));

    await db.insert(schema.setLogs).values({
      workoutSessionId: session.id,
      exerciseId: exerciseRow.exerciseId,
      clientId: client.profileId,
      setNumber: 1,
      reps: 8,
      weightKg: '60.00',
      clientLocalId: `bulk-edit-fixture-set-${session.id}`,
    });

    // The bulk edit, made AFTER the session above already completed.
    await caller(coach).programs.exercises.update({ programExerciseId, targetSets: 10 });

    // The live program row shows the new target — an upcoming session on
    // this same day would resolve 10, not 3.
    expect(await liveTargetSetsForDay(programDayId)).toBe(10);

    // But the completed session's frozen snapshot is untouched: it still
    // shows the OLD target it was actually performed against. This is
    // `program_snapshot`'s whole reason to exist (DB§14.6) and the seam
    // `../../features/programs/versioning.md`'s live-reference decision
    // draws around it — live-reference governs every session that hasn't
    // started; program_snapshot governs the one that already has.
    const [sessionAfter] = await db
      .select()
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, session.id));
    expect(sessionAfter?.status).toBe('completed');
    expect(sessionAfter?.programSnapshot).toEqual(frozenSnapshot);

    // And the historical set_logs row — what the client actually did — is
    // untouched too. History is immutable; a bulk edit only reaches
    // not-yet-performed sessions.
    const setLogsAfter = await db
      .select()
      .from(schema.setLogs)
      .where(eq(schema.setLogs.workoutSessionId, session.id));
    expect(setLogsAfter).toHaveLength(1);
    expect(setLogsAfter[0]).toMatchObject({ reps: 8, weightKg: '60.00' });
  });
});
