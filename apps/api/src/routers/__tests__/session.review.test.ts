// Real Postgres (`testing` skill §4). Seven things this suite exists for, and
// none of them survives a mocked Drizzle:
//
//   1. **The guard.** `session.review` takes a session id belonging to a
//      client, which `CLAUDE.md` §6.2 calls the single most likely place in
//      the project for a catastrophic data leak. The enumeration test
//      (`__tests__/authz.test.ts`) probes it generically; this asserts the
//      answer a coach actually gets, and that a foreign session and a
//      nonexistent one are indistinguishable (ER§2.1).
//   2. **The write inside a query.** `reviewed_at` is set on the first read
//      and must not be rewritten on the second — the idempotence that makes
//      `features/coach/session-review.ts` decision (a) acceptable at all.
//      Only a real row can show the second read leaving the instant alone.
//   3. **Performed order.** Groups come out ordered by their earliest
//      `logged_at`, not alphabetically and not by insertion. Both wrong
//      answers typecheck.
//   4. **The PR join.** `personal_records → set_log_id`, scoped by client.
//      A wrong join returns plausible flags on the wrong sets.
//   5. **The null-not-zero rule.** A bodyweight session's volume comes from
//      `recomputeSessionVolume`'s `SUM` over no qualifying rows, which is
//      SQL's answer, not TypeScript's.
//   6. **Where a skip goes.** A skip has no `logged_at`, so decision (c2)
//      places it by `program_exercises.order_index` and falls back to
//      appending. Both halves need a real program day and a real session
//      without one to tell apart.
//   7. **No N+1.** The statement count is asserted, not the result — a
//      correct response assembled one query per set row is still the bug.
//   8. **The header's two identity fields.** `clientName` and
//      `clientTimezone` are joined from `identity.users`, and the name has
//      to be the SAME string `coach.clients.overview` shows for the same
//      person — two surfaces reading one column, asserted against each
//      other rather than against a literal.
//   9. **The target scheme.** A group carries the block it was performed
//      against, `null` on a swap, on an ad-hoc session, and on a movement
//      the day never prescribed. Only a real `program_exercises` row shows
//      the difference between "prescribed nothing" and "prescribed zero".
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, recomputeSessionVolume, schema, type DbClient } from '@coachos/db';
import { formatTargetScheme } from '@coachos/utils';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import {
  getSessionReview,
  type SessionReview,
  type SessionReviewExerciseGroup,
  type SessionReviewSkippedExercise,
} from '../../features/coach/session-review.ts';
import type { ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;
let seeded: SeededSessions;

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

  const connectionString = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  fixture = await createTwoCoachesFixture(db);
  seeded = await seedSessions();
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

interface SeededSessions {
  /** The session every rendering assertion reads: three exercises, a swap, a skip, two PR sets. */
  full: string;
  alphaId: string;
  betaId: string;
  gammaId: string;
  /** `Gamma Curl` set 2 — holds two records at once. */
  gammaWorkingSetId: string;
  /** `Beta Row` set 1 — holds one. */
  betaSetId: string;
  /** Untouched by the rendering tests, so the reviewed-at pair can own it. */
  unreviewed: string;
  /** Pull-ups only: every set carries reps and no weight. */
  bodyweight: string;
  /** Coach A's, but withdrawn — the guard passes it and the resolver must not. */
  softDeleted: string;
  /** A program day's session: two exercises performed, the one prescribed between them skipped. */
  prescribed: string;
  /** The same three exercises and the same skip, with no program day to position it against. */
  adHoc: string;
  /**
   * A program day's session with NO skip in it — three groups against one
   * prescription: one prescribed and performed as written, one prescribed
   * but swapped, one never prescribed at all.
   */
  targets: string;
}

function coachId(): string {
  return fixture.coachA.profileId;
}

function clientId(): string {
  return fixture.clientA1.profileId;
}

async function insertSession(values: {
  scheduledDate: string;
  status: 'completed' | 'in_progress' | 'skipped' | 'scheduled';
  name?: string | null;
  durationSeconds?: number | null;
  perceivedExertion?: number | null;
  clientNotes?: string | null;
  reviewedAt?: Date | null;
  deletedAt?: Date | null;
  programDayId?: string | null;
}): Promise<string> {
  const started = values.status === 'completed' || values.status === 'in_progress';
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: clientId(),
      coachId: coachId(),
      scheduledDate: values.scheduledDate,
      status: values.status,
      name: values.name ?? null,
      // `session_completion` CHECK: a completed session carries both instants.
      startedAt: started ? new Date(`${values.scheduledDate}T09:00:00Z`) : null,
      completedAt:
        values.status === 'completed' ? new Date(`${values.scheduledDate}T10:00:00Z`) : null,
      durationSeconds: values.durationSeconds ?? null,
      perceivedExertion: values.perceivedExertion ?? null,
      clientNotes: values.clientNotes ?? null,
      reviewedAt: values.reviewedAt ?? null,
      deletedAt: values.deletedAt ?? null,
      programDayId: values.programDayId ?? null,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return row.id;
}

async function insertExercise(name: string): Promise<string> {
  const [row] = await db
    .insert(schema.exercises)
    .values({
      name,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

/**
 * One block of coach A's fixture program day, used only to give the skips a
 * prescribed position. Indices start at 10 so they never collide with the
 * block `two-coaches.ts` already puts at index 1.
 */
async function insertProgramExercise(
  exerciseId: string,
  orderIndex: number,
  target: Partial<{
    targetSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetRpe: string;
    targetRir: number;
    targetRestSeconds: number;
    tempo: string;
  }> = {},
): Promise<void> {
  await db.insert(schema.programExercises).values({
    programDayId: fixture.coachA.programDayId,
    exerciseId,
    orderIndex,
    targetSets: target.targetSets ?? 3,
    targetRepsMin: target.targetRepsMin ?? null,
    targetRepsMax: target.targetRepsMax ?? null,
    targetRpe: target.targetRpe ?? null,
    targetRir: target.targetRir ?? null,
    targetRestSeconds: target.targetRestSeconds ?? null,
    tempo: target.tempo ?? null,
  });
}

let setCounter = 0;

async function insertSetLog(values: {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  loggedAt: string;
  reps: number;
  weightKg?: string | null;
  rpe?: string | null;
  rir?: number | null;
  isWarmup?: boolean;
  isFailure?: boolean;
  notes?: string | null;
  clientProfileId?: string;
}): Promise<string> {
  setCounter += 1;
  const [row] = await db
    .insert(schema.setLogs)
    .values({
      workoutSessionId: values.sessionId,
      exerciseId: values.exerciseId,
      clientId: values.clientProfileId ?? clientId(),
      setNumber: values.setNumber,
      reps: values.reps,
      weightKg: values.weightKg ?? null,
      rpe: values.rpe ?? null,
      rir: values.rir ?? null,
      isWarmup: values.isWarmup ?? false,
      isFailure: values.isFailure ?? false,
      notes: values.notes ?? null,
      loggedAt: new Date(values.loggedAt),
      clientLocalId: `review-fixture-set-${String(setCounter)}`,
    })
    .returning({ id: schema.setLogs.id });
  if (!row) throw new Error('seed insert into set_logs did not return a row');
  return row.id;
}

async function insertRecord(values: {
  setLogId: string;
  exerciseId: string;
  recordType: string;
  clientProfileId?: string;
}): Promise<void> {
  await db.insert(schema.personalRecords).values({
    clientId: values.clientProfileId ?? clientId(),
    exerciseId: values.exerciseId,
    recordType: values.recordType,
    value: '100.00',
    setLogId: values.setLogId,
    achievedAt: new Date('2026-09-10T09:07:00Z'),
  });
}

/**
 * The `full` session is built so a wrong query fails rather than merely
 * returning fewer rows:
 *
 * - the three exercises are performed **Gamma, Alpha, Beta** while their
 *   names sort **Alpha, Beta, Gamma** — alphabetical ordering and performed
 *   ordering cannot both pass;
 * - Gamma's third set is logged **after** Beta's, so a grouping that keyed
 *   on contiguity rather than on the exercise would split it in two;
 * - Alpha's first set carries a substitution line and a note of the
 *   client's own on the line below it, so a parser that took the whole
 *   value or discarded it would be visible;
 * - one set holds **two** records and another holds one, so a join that
 *   returned a single flag per set would pass on the second and fail on the
 *   first;
 * - a record of `clientA2`'s hangs on a set of their own, so a query that
 *   dropped `personal_records.client_id` would reach it.
 */
async function seedSessions(): Promise<SeededSessions> {
  // A distinct name and a real zone on THIS client, so a `clientName` read
  // off the wrong row and a `clientTimezone` defaulted rather than read are
  // both visible. `clientA2` keeps the fixture's `'UTC'`, which is the
  // other half of the pair.
  await db
    .update(schema.users)
    .set({ name: 'Priya Fixture', timezone: 'Asia/Kolkata' })
    .where(eq(schema.users.id, fixture.clientA1.userId));

  const alphaId = await insertExercise('Alpha Press');
  const betaId = await insertExercise('Beta Row');
  const gammaId = await insertExercise('Gamma Curl');

  const full = await insertSession({
    scheduledDate: '2026-09-10',
    status: 'completed',
    name: 'Upper A',
    durationSeconds: 3600,
    perceivedExertion: 8,
    clientNotes: [
      'Skipped: Barbell Row — pain or discomfort (left shoulder)',
      'Skipped: Calf Raise — out of time',
      'Everything else moved well.',
    ].join('\n'),
  });

  await insertSetLog({
    sessionId: full,
    exerciseId: gammaId,
    setNumber: 1,
    loggedAt: '2026-09-10T09:05:00Z',
    reps: 10,
    weightKg: '20.00',
    isWarmup: true,
  });
  const gammaWorkingSetId = await insertSetLog({
    sessionId: full,
    exerciseId: gammaId,
    setNumber: 2,
    loggedAt: '2026-09-10T09:07:00Z',
    reps: 8,
    weightKg: '40.00',
    rpe: '8.5',
    rir: 2,
  });
  await insertSetLog({
    sessionId: full,
    exerciseId: alphaId,
    setNumber: 1,
    loggedAt: '2026-09-10T09:15:00Z',
    reps: 5,
    weightKg: '100.00',
    notes: 'Substituted for Omega Press.\nBar felt heavy',
  });
  await insertSetLog({
    sessionId: full,
    exerciseId: alphaId,
    setNumber: 2,
    loggedAt: '2026-09-10T09:20:00Z',
    reps: 5,
    weightKg: '100.00',
  });
  const betaSetId = await insertSetLog({
    sessionId: full,
    exerciseId: betaId,
    setNumber: 1,
    loggedAt: '2026-09-10T09:30:00Z',
    reps: 12,
    weightKg: '60.00',
    isFailure: true,
  });
  // Back to Gamma, after Beta — the non-contiguous set.
  await insertSetLog({
    sessionId: full,
    exerciseId: gammaId,
    setNumber: 3,
    loggedAt: '2026-09-10T09:40:00Z',
    reps: 6,
    weightKg: '42.50',
  });
  // Withdrawn: present in the table, absent from the screen and from the volume.
  const withdrawn = await insertSetLog({
    sessionId: full,
    exerciseId: betaId,
    setNumber: 2,
    loggedAt: '2026-09-10T09:45:00Z',
    reps: 12,
    weightKg: '60.00',
  });
  await db
    .update(schema.setLogs)
    .set({ deletedAt: new Date('2026-09-10T09:50:00Z') })
    .where(eq(schema.setLogs.id, withdrawn));

  await insertRecord({
    setLogId: gammaWorkingSetId,
    exerciseId: gammaId,
    recordType: 'max_weight',
  });
  await insertRecord({
    setLogId: gammaWorkingSetId,
    exerciseId: gammaId,
    recordType: '1rm_estimated',
  });
  await insertRecord({ setLogId: betaSetId, exerciseId: betaId, recordType: 'max_reps' });

  await db.transaction(async (tx) => {
    await recomputeSessionVolume(tx, full);
  });

  const unreviewed = await insertSession({
    scheduledDate: '2026-09-09',
    status: 'completed',
    name: 'Lower A',
  });

  const bodyweight = await insertSession({
    scheduledDate: '2026-09-08',
    status: 'completed',
    name: 'Pull-ups only',
  });
  const pullUpId = await insertExercise('Pull Up');
  await insertSetLog({
    sessionId: bodyweight,
    exerciseId: pullUpId,
    setNumber: 1,
    loggedAt: '2026-09-08T09:05:00Z',
    reps: 10,
  });
  await insertSetLog({
    sessionId: bodyweight,
    exerciseId: pullUpId,
    setNumber: 2,
    loggedAt: '2026-09-08T09:10:00Z',
    reps: 8,
  });
  await db.transaction(async (tx) => {
    await recomputeSessionVolume(tx, bodyweight);
  });

  const softDeleted = await insertSession({
    scheduledDate: '2026-09-07',
    status: 'completed',
    name: 'Withdrawn',
    deletedAt: new Date('2026-09-07T12:00:00Z'),
  });

  // The sibling client's record, on a set of their own — a query that
  // dropped `client_id` would still reach it.
  const siblingSet = await insertSetLog({
    sessionId: fixture.clientA2.workoutSessionId,
    exerciseId: alphaId,
    setNumber: 1,
    loggedAt: '2026-07-15T09:00:00Z',
    reps: 5,
    weightKg: '80.00',
    clientProfileId: fixture.clientA2.profileId,
  });
  await insertRecord({
    setLogId: siblingSet,
    exerciseId: alphaId,
    recordType: 'max_weight',
    clientProfileId: fixture.clientA2.profileId,
  });

  // Decision (c2)'s fixture. `Delta Fly` is prescribed BETWEEN the two
  // exercises the client actually did and is the one they skipped, so a
  // trailing "also skipped" block and a correctly interleaved row differ by
  // one position — and appending, the wrong answer, is also the fallback,
  // which the ad-hoc session below pins separately so the two cannot be
  // confused for each other.
  const deltaId = await insertExercise('Delta Fly');
  // Three different schemes, so a target read off the wrong block is a
  // different string rather than a coincidence: Alpha carries a rep RANGE
  // and an RPE, Beta a fixed rep count and an RIR, Delta neither.
  await insertProgramExercise(alphaId, 10, {
    targetSets: 4,
    targetRepsMin: 6,
    targetRepsMax: 8,
    targetRpe: '8.0',
  });
  await insertProgramExercise(deltaId, 20);
  await insertProgramExercise(betaId, 30, {
    targetSets: 3,
    targetRepsMin: 12,
    targetRepsMax: 12,
    targetRir: 2,
    targetRestSeconds: 90,
    tempo: '3010',
  });

  const skipNotes = 'Skipped: Delta Fly — out of time';

  const prescribed = await insertSession({
    scheduledDate: '2026-09-05',
    status: 'completed',
    name: 'Prescribed',
    clientNotes: skipNotes,
    programDayId: fixture.coachA.programDayId,
  });
  await insertSetLog({
    sessionId: prescribed,
    exerciseId: alphaId,
    setNumber: 1,
    loggedAt: '2026-09-05T09:05:00Z',
    reps: 5,
    weightKg: '100.00',
  });
  await insertSetLog({
    sessionId: prescribed,
    exerciseId: betaId,
    setNumber: 1,
    loggedAt: '2026-09-05T09:20:00Z',
    reps: 10,
    weightKg: '60.00',
  });

  const adHoc = await insertSession({
    scheduledDate: '2026-09-04',
    status: 'completed',
    name: 'Ad hoc',
    clientNotes: skipNotes,
  });
  await insertSetLog({
    sessionId: adHoc,
    exerciseId: alphaId,
    setNumber: 1,
    loggedAt: '2026-09-04T09:05:00Z',
    reps: 5,
    weightKg: '100.00',
  });
  await insertSetLog({
    sessionId: adHoc,
    exerciseId: betaId,
    setNumber: 1,
    loggedAt: '2026-09-04T09:20:00Z',
    reps: 10,
    weightKg: '60.00',
  });

  // Decision (f)'s fixture. No skip line at all, so the prescription read
  // has to fire for the TARGETS or two of these three assertions cannot be
  // told apart from "the statement never ran".
  const targets = await insertSession({
    scheduledDate: '2026-09-03',
    status: 'completed',
    name: 'Targets',
    programDayId: fixture.coachA.programDayId,
  });
  await insertSetLog({
    sessionId: targets,
    exerciseId: alphaId,
    setNumber: 1,
    loggedAt: '2026-09-03T09:05:00Z',
    reps: 7,
    weightKg: '100.00',
  });
  // Prescribed at index 30, and swapped into — the block's 12 reps at RIR 2
  // were written for `Omega Press`, not for this.
  await insertSetLog({
    sessionId: targets,
    exerciseId: betaId,
    setNumber: 1,
    loggedAt: '2026-09-03T09:20:00Z',
    reps: 10,
    weightKg: '60.00',
    notes: 'Substituted for Omega Press.',
  });
  // Never prescribed on this day at all — the client added it.
  await insertSetLog({
    sessionId: targets,
    exerciseId: gammaId,
    setNumber: 1,
    loggedAt: '2026-09-03T09:35:00Z',
    reps: 12,
    weightKg: '30.00',
  });

  return {
    full,
    alphaId,
    betaId,
    gammaId,
    gammaWorkingSetId,
    betaSetId,
    unreviewed,
    bodyweight,
    softDeleted,
    prescribed,
    adHoc,
    targets,
  };
}

// ---------------------------------------------------------------------------

function coachUser(profileId: string, userId: string): ContextUser {
  return {
    id: userId,
    email: 'coach@two-coaches-fixture.com',
    role: 'coach',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: profileId,
    clientProfileId: null,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

function callerFor(coach: { profileId: string; userId: string }) {
  return appRouter.createCaller(
    createTestContext({ db, user: coachUser(coach.profileId, coach.userId) }),
  );
}

function review(sessionId: string, coach = fixture.coachA) {
  return callerFor(coach).session.review({ sessionId });
}

/**
 * `exercises` is one ordered list of performed groups and skips
 * (`session-review.ts` decision (c2)), so every assertion below either reads
 * the sequence as a whole or narrows to one side of the union first.
 */
function sequenceOf(result: SessionReview): string[] {
  return result.exercises.map((entry) =>
    entry.kind === 'performed' ? entry.exerciseName : `skipped: ${entry.exerciseName}`,
  );
}

function performedOf(result: SessionReview): SessionReviewExerciseGroup[] {
  return result.exercises.filter(
    (entry): entry is SessionReviewExerciseGroup => entry.kind === 'performed',
  );
}

function skipsOf(result: SessionReview): SessionReviewSkippedExercise[] {
  return result.exercises.filter(
    (entry): entry is SessionReviewSkippedExercise => entry.kind === 'skipped',
  );
}

function groupOf(result: SessionReview, exerciseId: string): SessionReviewExerciseGroup {
  const group = performedOf(result).find((entry) => entry.exerciseId === exerciseId);
  if (group === undefined) throw new Error(`no performed group for exercise ${exerciseId}`);
  return group;
}

async function reviewedAtOf(sessionId: string): Promise<Date | null> {
  const [row] = await db
    .select({ reviewedAt: schema.workoutSessions.reviewedAt })
    .from(schema.workoutSessions)
    .where(eq(schema.workoutSessions.id, sessionId));
  return row?.reviewedAt ?? null;
}

/**
 * Counts the statements `getSessionReview` issues.
 *
 * A proxy over the two builder entry points the feature uses, rather than a
 * driver-level hook: the property being asserted is "how many statements
 * does assembling this response take", and that is exactly how many times
 * the resolver reaches for one. A count that grew with the number of sets
 * is the N+1 this suite exists to rule out.
 */
function countingDb(base: DbClient): { db: DbClient; statements: () => number } {
  let statements = 0;
  const proxy = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if ((property === 'select' || property === 'update') && typeof value === 'function') {
        return (...args: unknown[]): unknown => {
          statements += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  }) as DbClient;
  return { db: proxy, statements: () => statements };
}

// ---------------------------------------------------------------------------

describe('session.review — authorisation', () => {
  it("refuses a session belonging to another coach's client", async () => {
    await expect(review(fixture.clientB1.workoutSessionId)).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
  });

  it('answers a session id that never existed identically — no existence oracle', async () => {
    const foreign = await review(fixture.clientB1.workoutSessionId).catch(
      (error: unknown) => error,
    );
    const absent = await review('00000000-0000-7000-8000-000000000000').catch(
      (error: unknown) => error,
    );

    expect(foreign).toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
    expect(absent).toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
    expect((absent as Error).message).toBe((foreign as Error).message);
  });

  it("refuses the coach's own withdrawn session, and does not mark it reviewed", async () => {
    await expect(review(seeded.softDeleted)).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });

    expect(await reviewedAtOf(seeded.softDeleted)).toBeNull();
  });
});

describe('session.review — marking reviewed', () => {
  it('sets reviewed_at on the first read, leaves it alone on the second, and clears one from Needs review', async () => {
    expect(await reviewedAtOf(seeded.unreviewed)).toBeNull();
    const before = await callerFor(fixture.coachA).coach.dashboard();

    const first = await review(seeded.unreviewed);
    const stored = await reviewedAtOf(seeded.unreviewed);

    expect(stored).not.toBeNull();
    expect(first.reviewedAt).toEqual(stored);

    const after = await callerFor(fixture.coachA).coach.dashboard();
    expect(after.needsReview).toBe(before.needsReview - 1);

    const second = await review(seeded.unreviewed);

    // The instant the FIRST coach-visit produced, not a fresh `now()` — the
    // idempotence that makes a writing query defensible at all.
    expect(second.reviewedAt).toEqual(stored);
    expect(await reviewedAtOf(seeded.unreviewed)).toEqual(stored);
  });
});

describe('session.review — the session', () => {
  it('carries every figure the header draws, in kilograms and local-day form', async () => {
    const result = await review(seeded.full);

    expect(result).toMatchObject({
      sessionId: seeded.full,
      clientId: clientId(),
      // A `date` column, never an instant (`CLAUDE.md` §25.5).
      scheduledDate: '2026-09-10',
      name: 'Upper A',
      status: 'completed',
      durationSeconds: 3600,
      perceivedExertion: 8,
      skipReason: null,
    });
    // Σ (reps × kg) over working, non-withdrawn sets: 320 + 500 + 500 + 720
    // + 255 = 2295. The warm-up (10×20) and the withdrawn set (12×60) are
    // both absent, and each would move this figure if it were not.
    // `numeric` parsed once at the boundary, never handed over as a string.
    expect(result.totalVolumeKg).toBe(2295);
  });

  it('separates the skips the client took from the words they wrote', async () => {
    const result = await review(seeded.full);

    expect(skipsOf(result)).toEqual([
      {
        kind: 'skipped',
        exerciseName: 'Barbell Row',
        reasonLabel: 'pain or discomfort',
        note: 'left shoulder',
      },
      { kind: 'skipped', exerciseName: 'Calf Raise', reasonLabel: 'out of time', note: null },
    ]);
    expect(result.clientNotes).toBe('Everything else moved well.');
  });

  it('reports no volume rather than zero for a bodyweight-only session', async () => {
    const result = await review(seeded.bodyweight);

    // A bodyweight session did not lift nothing (`COPY.md` CO§2).
    expect(result.totalVolumeKg).toBeNull();
    expect(performedOf(result)[0]?.sets.map((set) => set.weightKg)).toEqual([null, null]);
  });
});

describe('session.review — the sets', () => {
  it('groups by exercise in the order they were performed, not alphabetically', async () => {
    const result = await review(seeded.full);

    expect(performedOf(result).map((group) => group.exerciseName)).toEqual([
      'Gamma Curl',
      'Alpha Press',
      'Beta Row',
    ]);
  });

  it('keeps a non-contiguous return to an exercise in its original group', async () => {
    const result = await review(seeded.full);
    const gamma = groupOf(result, seeded.gammaId);

    expect(gamma.sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
  });

  it('excludes a withdrawn set', async () => {
    const result = await review(seeded.full);
    const beta = groupOf(result, seeded.betaId);

    expect(beta.sets).toHaveLength(1);
  });

  it('renders one set exactly as the client logged it', async () => {
    const result = await review(seeded.full);
    const gamma = groupOf(result, seeded.gammaId);

    expect(gamma.sets[0]).toMatchObject({ setNumber: 1, isWarmup: true, weightKg: 20, reps: 10 });
    expect(gamma.sets[1]).toMatchObject({
      setLogId: seeded.gammaWorkingSetId,
      setNumber: 2,
      reps: 8,
      weightKg: 40,
      rpe: 8.5,
      rir: 2,
      isWarmup: false,
      isFailure: false,
      notes: null,
      loggedAt: new Date('2026-09-10T09:07:00Z'),
    });
  });

  it("names what a swapped exercise replaced, and keeps the client's own note", async () => {
    const result = await review(seeded.full);
    const alpha = groupOf(result, seeded.alphaId);

    expect(alpha.substitutedFor).toBe('Omega Press');
    expect(alpha.sets.map((set) => set.notes)).toEqual(['Bar felt heavy', null]);
  });

  it('leaves an unsubstituted exercise unmarked', async () => {
    const result = await review(seeded.full);
    const beta = groupOf(result, seeded.betaId);

    expect(beta.substitutedFor).toBeNull();
    expect(beta.sets[0]).toMatchObject({ isFailure: true, reps: 12 });
  });
});

describe('session.review — where a skip goes', () => {
  it('places a skip at its prescribed position, between the exercises either side', async () => {
    const result = await review(seeded.prescribed);

    // `Delta Fly` is prescribed at index 20, between Alpha (10) and Beta
    // (30). A trailing block would read ['Alpha Press', 'Beta Row',
    // 'skipped: Delta Fly'] and is the answer this rules out.
    expect(sequenceOf(result)).toEqual(['Alpha Press', 'skipped: Delta Fly', 'Beta Row']);
  });

  it('appends a skip it cannot position, rather than guessing at one', async () => {
    const result = await review(seeded.adHoc);

    // No `program_day_id`, so no prescribed order to appeal to. The order is
    // unknown, and appending says so.
    expect(sequenceOf(result)).toEqual(['Alpha Press', 'Beta Row', 'skipped: Delta Fly']);
  });

  it('renders a skip with the reason and the words the client added', async () => {
    const result = await review(seeded.prescribed);

    expect(skipsOf(result)).toEqual([
      { kind: 'skipped', exerciseName: 'Delta Fly', reasonLabel: 'out of time', note: null },
    ]);
  });
});

describe('session.review — who trained, and when their day was', () => {
  it("carries the client's own IANA zone, never a time formatted in the coach's", async () => {
    const result = await review(seeded.full);

    // The zone, raw. A server-formatted instant would be formatted in
    // whatever zone the API happens to run in, which for a coach in Mumbai
    // reading a client in Toronto is §25.5's exact trap.
    expect(result.clientTimezone).toBe('Asia/Kolkata');
    // And the training day still needs no zone to be right — it is a `date`.
    expect(result.scheduledDate).toBe('2026-09-10');
    expect(result.startedAt).toEqual(new Date('2026-09-10T09:00:00Z'));
  });

  it("returns 'UTC' for a client who never set a zone — not null, not empty", async () => {
    const result = await review(fixture.clientA2.workoutSessionId);

    // `users.timezone` is NOT NULL DEFAULT 'UTC': an unset preference is
    // still a zone. A header handed `null` here would silently fall back to
    // the coach's device.
    expect(result.clientTimezone).toBe('UTC');
  });

  it('names the client exactly as the client-detail surfaces name them', async () => {
    const result = await review(seeded.full);
    const overview = await callerFor(fixture.coachA).coach.clients.overview({
      clientId: clientId(),
    });

    // One column, two screens (`session-review.ts` decision (e)). Asserted
    // against the other surface rather than only against a literal, because
    // the failure that matters is the two disagreeing.
    expect(result.clientName).toBe(overview.name);
    expect(result.clientName).toBe('Priya Fixture');
  });
});

describe('session.review — what each group was asked for', () => {
  it('carries the prescribed block in the shape formatTargetScheme reads', async () => {
    const result = await review(seeded.targets);
    const alpha = groupOf(result, seeded.alphaId);

    expect(alpha.target).toEqual({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      // `numeric(3,1)` parsed once at the boundary — 8, never '8.0'.
      targetRpe: 8,
      targetRir: null,
      targetWeightKg: null,
      targetPercent1rm: null,
      targetRestSeconds: null,
      tempo: null,
    });

    if (alpha.target === null) throw new Error('expected a target on the prescribed group');
    // The design's group head, and the same string the coach's own program
    // day and the client's logger print from the same function.
    expect(formatTargetScheme(alpha.target, 'kg')).toBe('4 × 6–8 · RPE 8');
  });

  it('carries the whole block, tempo and rest included, not just the two parts drawn', async () => {
    const result = await review(seeded.prescribed);
    const beta = groupOf(result, seeded.betaId);

    if (beta.target === null) throw new Error('expected a target on the prescribed group');
    expect(beta.target).toMatchObject({ targetSets: 3, targetRir: 2, tempo: '3010' });
    expect(formatTargetScheme(beta.target, 'kg')).toBe('3 × 12 · RIR 2 · 3010 · 90s');
  });

  it('reports no target on a substituted group, rather than the block it replaced', async () => {
    const result = await review(seeded.targets);
    const beta = groupOf(result, seeded.betaId);

    // `Beta Row` IS prescribed on this day, at index 30 — and that block's
    // 12 reps at RIR 2 were written for `Omega Press`. Attributing them
    // here would misreport what the coach asked for.
    expect(beta.substitutedFor).toBe('Omega Press');
    expect(beta.target).toBeNull();
  });

  it('reports no target for an exercise the day never prescribed', async () => {
    const result = await review(seeded.targets);
    const gamma = groupOf(result, seeded.gammaId);

    // The client added this one. Asked for nothing is not asked for zero.
    expect(gamma.target).toBeNull();
  });

  it('reports no target at all for an ad-hoc session', async () => {
    const result = await review(seeded.adHoc);

    // No `program_day_id`, so there is no prescription to read — even
    // though both exercises are prescribed on some OTHER day.
    expect(performedOf(result).map((group) => group.target)).toEqual([null, null]);
  });

  it('gives a skip no target — the row says only that it did not happen', async () => {
    const result = await review(seeded.prescribed);
    const [skip] = skipsOf(result);

    expect(skip).toBeDefined();
    expect(skip).not.toHaveProperty('target');
  });

  it('still places a skip at its prescribed position when the same read carries targets', async () => {
    const result = await review(seeded.prescribed);

    // Decision (c2), unchanged by the fifth statement widening — the
    // prescription is read once and answers both questions.
    expect(sequenceOf(result)).toEqual(['Alpha Press', 'skipped: Delta Fly', 'Beta Row']);
    expect(groupOf(result, seeded.alphaId).target).toMatchObject({ targetSets: 4 });
  });
});

describe('session.review — personal records', () => {
  it('flags every record a set holds, on that set and no other', async () => {
    const result = await review(seeded.full);
    const flags = new Map(
      performedOf(result).flatMap((group) =>
        group.sets.map((set) => [set.setLogId, set.personalRecordTypes] as const),
      ),
    );

    expect(flags.get(seeded.gammaWorkingSetId)).toEqual(['1rm_estimated', 'max_weight']);
    expect(flags.get(seeded.betaSetId)).toEqual(['max_reps']);
    for (const [setLogId, types] of flags) {
      if (setLogId === seeded.gammaWorkingSetId || setLogId === seeded.betaSetId) continue;
      expect(types).toEqual([]);
    }
  });
});

describe('session.review — statement count', () => {
  it('does not grow with the number of sets', async () => {
    const counted = countingDb(db);

    await getSessionReview(counted.db, seeded.full);

    // One write, the session (with the client's name and zone joined onto
    // it, not fetched beside it), its sets, its records. Seven set rows,
    // three exercises and two skips change none of them — `full` has no
    // `program_day_id`, so there is no prescription to read.
    expect(counted.statements()).toBe(4);
  });

  it('reads the prescription once for a session that has a program day', async () => {
    const counted = countingDb(db);

    await getSessionReview(counted.db, seeded.prescribed);

    // The four above plus `prescriptionQuery`. Two skips and twenty
    // prescribed blocks would still be five.
    expect(counted.statements()).toBe(5);
  });

  it('reads it once for the targets too, not a second time and not per group', async () => {
    const counted = countingDb(db);

    const result = await getSessionReview(counted.db, seeded.targets);

    // No skip in this session at all, so the fifth statement is firing
    // purely for the target schemes — and three groups still cost one.
    expect(performedOf(result)).toHaveLength(3);
    expect(counted.statements()).toBe(5);
  });

  it('does not read the prescription for a session with no program day', async () => {
    const counted = countingDb(db);

    // `bodyweight` is ad-hoc: nothing prescribed it, so there is nothing to
    // position a skip against and nothing to name as a target.
    await getSessionReview(counted.db, seeded.bodyweight);

    expect(counted.statements()).toBe(4);
  });

  it('skips the record read entirely for a session with no sets', async () => {
    const empty = await insertSession({ scheduledDate: '2026-09-06', status: 'in_progress' });
    const counted = countingDb(db);

    const result = await getSessionReview(counted.db, empty);

    expect(result.exercises).toEqual([]);
    expect(counted.statements()).toBe(3);
  });
});
