// Real Postgres (`testing` skill §4). Four things this suite exists for,
// and none of them survives a mocked Drizzle:
//
//   1. **The guard.** `coach.clients.trainingHistory` takes a `clientId`,
//      which `CLAUDE.md` §6.2 calls the single most likely place in the
//      project for a catastrophic data leak. The enumeration test
//      (`__tests__/authz.test.ts`) probes it generically; this asserts the
//      answer a coach actually gets.
//   2. **The PR count.** The join is `personal_records → set_logs →
//      workout_session_id` and it is the task's stated Risk. A wrong join
//      typechecks perfectly and returns plausible numbers; only real rows
//      can tell a record set in THIS session from one set in a sibling.
//   3. **The keyset.** `(scheduled_date, id)` exists because two sessions
//      can share a date. A cursor on the date alone also typechecks, and
//      silently drops one of them at a page boundary.
//   4. **The status filter.** `scheduled` is excluded and `deleted_at` is
//      honoured — both are `WHERE` clauses, which no unit test can check.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
} from '../../features/coach/client-training-history.ts';
import type { ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;
let seeded: SeededHistory;

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
  seeded = await seedHistory();
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

interface SeededHistory {
  /** Newest first — the order the procedure must return them in. */
  expectedOrder: string[];
  /** The 8 Sep pair, already in `id DESC` order. */
  sameDayFirst: string;
  sameDaySecond: string;
  reviewed: string;
  unreviewed: string;
  skipped: string;
  twoRecords: string;
  namedByProgramDay: string;
  softDeleted: string;
  stillScheduled: string;
  /** `clientA2`'s only non-fixture session — deleted by the empty-history test. */
  otherClientSession: string;
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
  programDayId?: string | null;
  durationSeconds?: number | null;
  totalVolumeKg?: string | null;
  reviewedAt?: Date | null;
  skipReason?: string | null;
  deletedAt?: Date | null;
  clientId?: string;
}): Promise<string> {
  const started = values.status === 'completed' || values.status === 'in_progress';
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: values.clientId ?? clientId(),
      coachId: coachId(),
      scheduledDate: values.scheduledDate,
      status: values.status,
      name: values.name ?? null,
      programDayId: values.programDayId ?? null,
      // `session_completion` CHECK: a completed session must carry both
      // instants. Derived from the scheduled date so the row is coherent.
      startedAt: started ? new Date(`${values.scheduledDate}T09:00:00Z`) : null,
      completedAt:
        values.status === 'completed' ? new Date(`${values.scheduledDate}T10:00:00Z`) : null,
      durationSeconds: values.durationSeconds ?? null,
      totalVolumeKg: values.totalVolumeKg ?? null,
      reviewedAt: values.reviewedAt ?? null,
      skipReason: values.skipReason ?? null,
      deletedAt: values.deletedAt ?? null,
    })
    .returning({ id: schema.workoutSessions.id });
  if (!row) throw new Error('seed insert into workout_sessions did not return a row');
  return row.id;
}

let exerciseCounter = 0;

/** One library exercise per record, so `personal_records`' `(client, exercise, type)` unique never collides by accident. */
async function insertExercise(): Promise<string> {
  exerciseCounter += 1;
  const [row] = await db
    .insert(schema.exercises)
    .values({
      name: `History Fixture Exercise ${String(exerciseCounter)}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!row) throw new Error('seed insert into exercises did not return a row');
  return row.id;
}

let setCounter = 0;

async function insertSetLog(
  sessionId: string,
  exerciseId: string,
  opts: { clientId?: string; deletedAt?: Date | null } = {},
): Promise<string> {
  setCounter += 1;
  const [row] = await db
    .insert(schema.setLogs)
    .values({
      workoutSessionId: sessionId,
      exerciseId,
      clientId: opts.clientId ?? clientId(),
      setNumber: 1,
      reps: 5,
      weightKg: '100.00',
      clientLocalId: `history-fixture-set-${String(setCounter)}`,
      deletedAt: opts.deletedAt ?? null,
    })
    .returning({ id: schema.setLogs.id });
  if (!row) throw new Error('seed insert into set_logs did not return a row');
  return row.id;
}

async function insertRecord(
  setLogId: string,
  exerciseId: string,
  recordClientId: string,
): Promise<void> {
  await db.insert(schema.personalRecords).values({
    clientId: recordClientId,
    exerciseId,
    recordType: 'max_weight',
    value: '100.00',
    setLogId,
    achievedAt: new Date('2026-09-01T10:00:00Z'),
  });
}

/**
 * Nine sessions, chosen so a wrong query fails rather than merely returning
 * fewer rows:
 *
 * - two on **8 Sep**, which is the only reason `id` is in the keyset;
 * - one **soft-deleted** and one still **scheduled**, both of which a naive
 *   `WHERE client_id = …` would happily return;
 * - two records set in the 6 Sep session and one in 4 Sep, so a join that
 *   credited every record to every session would report 3 on both;
 * - a record belonging to `clientA2`, so a query that forgot `client_id`
 *   would over-count;
 * - a record whose set log is **withdrawn**, so the `deleted_at IS NULL`
 *   clause on the join has something to exclude.
 */
async function seedHistory(): Promise<SeededHistory> {
  const stillScheduled = await insertSession({
    scheduledDate: '2026-09-12',
    status: 'scheduled',
  });
  const softDeleted = await insertSession({
    scheduledDate: '2026-09-11',
    status: 'completed',
    name: 'Deleted session',
    deletedAt: new Date('2026-09-11T12:00:00Z'),
  });

  const unreviewed = await insertSession({
    scheduledDate: '2026-09-10',
    status: 'completed',
    name: 'Upper A',
    durationSeconds: 2880,
    totalVolumeKg: '7240.50',
    reviewedAt: null,
  });
  // Two on one date — the tie the `id` half of the keyset exists for.
  const sameDayA = await insertSession({
    scheduledDate: '2026-09-08',
    status: 'completed',
    name: 'Morning lift',
  });
  const sameDayB = await insertSession({
    scheduledDate: '2026-09-08',
    status: 'completed',
    name: 'Evening conditioning',
  });
  const twoRecords = await insertSession({
    scheduledDate: '2026-09-06',
    status: 'completed',
    name: 'Lower B',
    durationSeconds: 3720,
    totalVolumeKg: '9110.00',
  });
  const skipped = await insertSession({
    scheduledDate: '2026-09-05',
    status: 'skipped',
    name: 'Lower A',
    skipReason: 'travelling',
  });
  const namedByProgramDay = await insertSession({
    scheduledDate: '2026-09-04',
    status: 'in_progress',
    // No name of its own — the row must fall back to the program day's.
    name: null,
    programDayId: fixture.coachA.programDayId,
  });
  const reviewed = await insertSession({
    scheduledDate: '2026-09-02',
    status: 'completed',
    name: 'Upper B',
    reviewedAt: new Date('2026-09-03T08:00:00Z'),
  });

  // Two records in one session, on two exercises.
  const exA = await insertExercise();
  const exB = await insertExercise();
  await insertRecord(await insertSetLog(twoRecords, exA), exA, clientId());
  await insertRecord(await insertSetLog(twoRecords, exB), exB, clientId());

  // One record in a different session — the sibling that must not leak.
  const exC = await insertExercise();
  await insertRecord(await insertSetLog(namedByProgramDay, exC), exC, clientId());

  // A record whose set log was withdrawn: excluded.
  const exD = await insertExercise();
  const withdrawnSet = await insertSetLog(unreviewed, exD, {
    deletedAt: new Date('2026-09-10T11:00:00Z'),
  });
  await insertRecord(withdrawnSet, exD, clientId());

  // The sibling client's record, hung on a session of THEIR own, so a query
  // that dropped `personal_records.client_id` would still reach it.
  const exE = await insertExercise();
  const otherClientSession = await insertSession({
    scheduledDate: '2026-07-15',
    status: 'completed',
    clientId: fixture.clientA2.profileId,
  });
  const otherSet = await insertSetLog(otherClientSession, exE, {
    clientId: fixture.clientA2.profileId,
  });
  await insertRecord(otherSet, exE, fixture.clientA2.profileId);

  // `id DESC` breaks the 8 Sep tie. Row ids are uuidv7 and sort lexically,
  // so the expected order is derived from the ids rather than assumed from
  // insertion order.
  const [sameDayFirst, sameDaySecond] = [sameDayA, sameDayB].sort().reverse();
  if (sameDayFirst === undefined || sameDaySecond === undefined) {
    throw new Error('two same-day sessions were not seeded');
  }

  return {
    expectedOrder: [
      unreviewed,
      sameDayFirst,
      sameDaySecond,
      twoRecords,
      skipped,
      namedByProgramDay,
      reviewed,
    ],
    sameDayFirst,
    sameDaySecond,
    reviewed,
    unreviewed,
    skipped,
    twoRecords,
    namedByProgramDay,
    softDeleted,
    stillScheduled,
    otherClientSession,
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

const DEFAULT_LIMIT = 30;

/**
 * `cursor` is built into the object rather than passed as `undefined`:
 * `exactOptionalPropertyTypes` is on, so an explicit `undefined` is not the
 * same as an absent key (`code-conventions` §3).
 */
function callAs(
  coach: { profileId: string; userId: string },
  target: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const input =
    opts.cursor === undefined
      ? { clientId: target, limit: opts.limit ?? DEFAULT_LIMIT }
      : { clientId: target, limit: opts.limit ?? DEFAULT_LIMIT, cursor: opts.cursor };

  return appRouter
    .createCaller(createTestContext({ db, user: coachUser(coach.profileId, coach.userId) }))
    .coach.clients.trainingHistory(input);
}

function call(opts: { cursor?: string; limit?: number } = {}) {
  return callAs(fixture.coachA, clientId(), opts);
}

/** A cursor's raw payload, for the decoder's negative cases. */
function rawCursor(payload: string): string {
  return Buffer.from(payload, 'utf8').toString('base64url');
}

const UNIT_SEPARATOR = String.fromCharCode(31);

// ---------------------------------------------------------------------------

describe('coach.clients.trainingHistory', () => {
  it('refuses a client belonging to another coach', async () => {
    await expect(callAs(fixture.coachB, fixture.clientA1.profileId)).rejects.toMatchObject({
      cause: { appCode: 'NOT_YOUR_CLIENT' },
    });
  });

  it('returns the coach’s own client’s sessions, most recent first', async () => {
    const page = await call();

    expect(page.items.map((item) => item.sessionId)).toEqual(seeded.expectedOrder);
  });

  it('excludes a scheduled session and a soft-deleted one', async () => {
    const page = await call();
    const ids = new Set(page.items.map((item) => item.sessionId));

    expect(ids.has(seeded.stillScheduled)).toBe(false);
    expect(ids.has(seeded.softDeleted)).toBe(false);
    // The fixture's own `scheduled` session for this client, seeded by
    // `two-coaches.ts` on 2026-08-01, is the second `scheduled` exclusion.
    expect(ids.has(fixture.clientA1.workoutSessionId)).toBe(false);
  });

  it('counts only the records set in each session, by this client', async () => {
    const page = await call();
    const counts = new Map(page.items.map((item) => [item.sessionId, item.personalRecordCount]));

    expect(counts.get(seeded.twoRecords)).toBe(2);
    expect(counts.get(seeded.namedByProgramDay)).toBe(1);
    // Its only record hangs on a withdrawn set log.
    expect(counts.get(seeded.unreviewed)).toBe(0);
    expect(counts.get(seeded.reviewed)).toBe(0);
  });

  it('carries every figure the row draws, with no second round trip', async () => {
    const page = await call();
    const row = page.items.find((item) => item.sessionId === seeded.unreviewed);

    expect(row).toMatchObject({
      scheduledDate: '2026-09-10',
      name: 'Upper A',
      status: 'completed',
      durationSeconds: 2880,
      // `numeric` parsed once at the boundary, never handed to the device as a string.
      totalVolumeKg: 7240.5,
      reviewedAt: null,
      skipReason: null,
    });
  });

  it('reports a reviewed session’s instant, which is what "Needs review" is the absence of', async () => {
    const page = await call();
    const row = page.items.find((item) => item.sessionId === seeded.reviewed);

    expect(row?.reviewedAt).toEqual(new Date('2026-09-03T08:00:00Z'));
  });

  it('falls back to the program day’s name when the session has none', async () => {
    const page = await call();
    const row = page.items.find((item) => item.sessionId === seeded.namedByProgramDay);

    expect(row?.name).toBe('Fixture Day');
  });

  it('carries the skip reason on a skipped session and nowhere else', async () => {
    const page = await call();

    expect(page.items.find((item) => item.sessionId === seeded.skipped)).toMatchObject({
      status: 'skipped',
      skipReason: 'travelling',
      durationSeconds: null,
      totalVolumeKg: null,
    });
    expect(page.items.find((item) => item.sessionId === seeded.twoRecords)?.skipReason).toBeNull();
  });

  it('pages through the whole history without skipping or repeating a row', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page: Awaited<ReturnType<typeof call>> =
        cursor === undefined ? await call({ limit: 2 }) : await call({ limit: 2, cursor });
      seen.push(...page.items.map((item) => item.sessionId));
      pages += 1;
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      if (pages > 10) throw new Error('pagination did not terminate');
    }

    // Seven rows at two a page: 2, 2, 2, 1 — and the 8 Sep pair straddles a
    // page boundary, which is the case a date-only cursor loses.
    expect(pages).toBe(4);
    expect(seen).toEqual(seeded.expectedOrder);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('splits the two same-day sessions across a page boundary and keeps both', async () => {
    const first = await call({ limit: 2 });
    expect(first.items.map((item) => item.sessionId)).toEqual([
      seeded.unreviewed,
      seeded.sameDayFirst,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await call({ limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items[0]?.sessionId).toBe(seeded.sameDaySecond);
  });

  it('returns a null cursor on the last page', async () => {
    const page = await call({ limit: 100 });

    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(seeded.expectedOrder.length);
  });

  it('restarts from the top on a cursor this API never issued', async () => {
    // Well-formed base64url, so the input schema accepts it; nonsense once
    // decoded, so the query rewinds rather than throwing mid-scroll.
    const page = await call({ cursor: rawCursor('nonsense') });

    expect(page.items.map((item) => item.sessionId)).toEqual(seeded.expectedOrder);
  });

  it('returns an empty page, and no cursor, for a client with no history', async () => {
    // `clientA2`'s one history row is the session seeded for the record
    // test above; its `scheduled` fixture session stays and must still be
    // excluded, which is what makes this assertion worth making.
    await db
      .delete(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, seeded.otherClientSession));

    const page = await callAs(fixture.coachA, fixture.clientA2.profileId);

    expect(page).toEqual({ items: [], nextCursor: null });
  });
});

describe('the history cursor', () => {
  it('round-trips a date and an id', () => {
    const cursor = encodeHistoryCursor({
      scheduledDate: '2026-09-08',
      sessionId: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
    });

    expect(decodeHistoryCursor(cursor)).toEqual({
      scheduledDate: '2026-09-08',
      sessionId: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
    });
  });

  it('refuses anything that is not a date, a separator, and an id', () => {
    expect(decodeHistoryCursor(rawCursor('nonsense'))).toBeNull();
    expect(decodeHistoryCursor(rawCursor('2026-09-08'))).toBeNull();
    expect(decodeHistoryCursor(rawCursor(`not-a-date${UNIT_SEPARATOR}abc`))).toBeNull();
    expect(decodeHistoryCursor(rawCursor(`2026-09-08${UNIT_SEPARATOR}`))).toBeNull();
  });
});
