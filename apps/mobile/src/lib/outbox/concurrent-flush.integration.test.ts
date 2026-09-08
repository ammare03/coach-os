// The phase-08 exit gate: "Double-flushing the outbox creates zero duplicate
// rows" (DB§14.4's closing line, `phase-08-offline-core/README.md`'s gate).
//
// Full stack, both halves real. The client half is the shipped outbox —
// `enqueueMutation`, `claimReadyEntries`, `flushOutbox` — over the
// `expo-sqlite` fake. The server half is a real Postgres in a container,
// migrated by `packages/db`'s own migrator, written through
// `apps/api`'s `offlineUpsert` against the real `sessions_client_local`,
// `set_logs_client_local`, and `meals_client_local` indexes. Nothing about
// idempotency is stubbed on either side, because the guarantee is a property
// of the two together and a mock of either half proves half of it.
//
// ─── If this file fails, read this first ─────────────────────────────────
//
// The guarantee rests on TWO independent mechanisms, and the assertions are
// deliberately split so a failure names which one broke:
//
//   1. `deliveries` — one send per enqueued mutation. This is
//      `flush.ts`'s `claimReadyEntries`: the SELECT and the
//      `status='inflight'` UPDATE inside one synchronous SQLite transaction
//      with no `await` between them. A duplicate DELIVERY means that claim
//      is no longer atomic — an `await` added inside it, or the UPDATE moved
//      outside `db.transaction`. Server row counts stay correct even when
//      this breaks, because the upsert absorbs it; that is exactly why this
//      assertion exists separately.
//
//   2. server row counts — one row per `client_local_id`. This is
//      `apps/api/src/lib/offline-upsert.ts` plus the unique indexes. A
//      duplicate ROW means a procedure stopped upserting, or an index was
//      dropped or narrowed.
//
// A third assertion, `sendFailures`, catches the ordering rule (DB§14.2):
// the set sender resolves its session's SERVER id and throws if the session
// has not synced, so an out-of-order flush surfaces as a failure here rather
// than as a silently orphaned set.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { offlineUpsert } from 'api/src/lib/offline-upsert.ts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { getLocalDb, resetLocalDbForTests, type LocalDb } from '../../db/client.ts';

import { enqueueMutation } from './enqueue.ts';
import {
  FLUSH_BATCH_SIZE,
  flushOutbox,
  MAX_ATTEMPTS,
  resetOutboxFlushStateForTests,
  runFlushPass,
  type OutboxSender,
} from './flush.ts';

// Same reason as `flush.test.ts`: the real module reaches PostHog's native
// client, and nothing here asserts on an event.
jest.mock('../analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asProcedureName: (path: string) => path,
}));

// `expo-sqlite` has no Jest-side native module — the hand-built fake in
// `__fixtures__/sqlite-fake.ts` is what every outbox suite runs against.
jest.mock('expo-sqlite', () => require('./__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

jest.setTimeout(600_000);

/** Ahead of the wall clock `enqueueMutation` stamps rows with, so a fresh row is always due. */
const FIXED_NOW = Date.now() + 60_000;

/** How many times the adversarial race is replayed. DB§14.4's verification bar. */
const RACE_ITERATIONS = 20;

/**
 * Sets per session, and the number is load-bearing rather than decorative.
 *
 * `claimReadyEntries` is synchronous, so whichever loop passes first takes
 * every ready row up to `FLUSH_BATCH_SIZE` in one atomic gulp. Measured over
 * 10 iterations: at 4 sets the second loop wins a row in 0/10 runs — it only
 * ever observes rows already `'inflight'` and skips them, which exercises
 * half the guard. Past the batch size it wins in 7/10, so the two loops
 * genuinely PARTITION the queue. 30 is also an ordinary session (six
 * exercises, five sets), not a synthetic number.
 */
const SETS_PER_SESSION = FLUSH_BATCH_SIZE + 10;

// ─── Container, migrations, fixtures ─────────────────────────────────────

let container: StartedTestContainer;
let db: DbClient;
let coachProfileId: string;
let clientProfileId: string;
let exerciseId: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // Subprocess, matching `apps/api/src/lib/offline-upsert.test.ts` —
  // `migrate.ts` reads `import.meta.url`, which neither ts-jest's nor
  // babel-preset-expo's CommonJS transpile can execute in-process.
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

  const [coachUser] = await db
    .insert(schema.users)
    .values({
      email: `coach-${FIXED_NOW}@concurrent-flush.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
    })
    .returning();
  if (!coachUser) throw new Error('fixture: users insert returned no row');

  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: coachUser.id })
    .returning();
  if (!coachProfile) throw new Error('fixture: coach_profiles insert returned no row');
  coachProfileId = coachProfile.id;

  const [clientUser] = await db
    .insert(schema.users)
    .values({
      email: `client-${FIXED_NOW}@concurrent-flush.test`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
    })
    .returning();
  if (!clientUser) throw new Error('fixture: users insert returned no row');

  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: clientUser.id,
      coachId: coachProfileId,
      status: 'active',
      activatedAt: new Date(),
    })
    .returning();
  if (!clientProfile) throw new Error('fixture: client_profiles insert returned no row');
  clientProfileId = clientProfile.id;

  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Fixture Squat ${FIXED_NOW}`,
      primaryMuscle: 'quadriceps',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning();
  if (!exercise) throw new Error('fixture: exercises insert returned no row');
  exerciseId = exercise.id;
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

beforeEach(() => {
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  sqliteFake.__reset();
});

// ─── Narrowing the payload the outbox hands back ─────────────────────────
//
// `OutboxSender` receives `Record<string, unknown>` because that is what a
// superjson-decoded row genuinely is — the payload survived a write to and a
// read from SQLite, and no type can constrain that (`code-conventions` §3).

type Payload = Record<string, unknown>;

function readString(input: Payload, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') throw new Error(`payload.${key} is not a string`);
  return value;
}

function readNumber(input: Payload, key: string): number {
  const value = input[key];
  if (typeof value !== 'number') throw new Error(`payload.${key} is not a number`);
  return value;
}

function readDate(input: Payload, key: string): Date {
  const value = input[key];
  // A `Date` here rather than a string is the superjson round-trip holding:
  // a set timestamped at action time must not become a string, or every
  // synced row ends up dated at reconnect (`offline-sync` §10).
  if (!(value instanceof Date)) throw new Error(`payload.${key} is not a Date`);
  return value;
}

// ─── The server sender ───────────────────────────────────────────────────

interface Delivery {
  procedure: string;
  clientLocalId: string;
}

interface ServerSender {
  send: OutboxSender;
  deliveries: Delivery[];
  failures: { clientLocalId: string; message: string }[];
  /** Resolves once `count` sends have entered the sender and not yet returned. */
  whenInFlight: (count: number) => Promise<void>;
}

interface ServerSenderOptions {
  /** Macrotask ticks each send waits before touching Postgres — the race window. */
  delayTicks?: (delivery: Delivery) => number;
  /** Held open by every send while it resolves; used to park sends mid-flight. */
  gate?: Promise<void>;
  /** `clientLocalId`s whose send answers with a genuine 409 instead of upserting. */
  conflicting?: ReadonlySet<string>;
}

/** A real macrotask, not a microtask — a microtask-only yield starves Postgres IO. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitTicks(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await tick();
}

/**
 * The tRPC-shaped 409 the flush loop treats as a definitive answer rather
 * than a retryable failure (DB§14.4, `flush.ts`'s `isConflictFailure`).
 */
function conflictError(): Error {
  return Object.assign(new Error('conflict'), {
    data: { httpStatus: 409, code: 'CONFLICT' },
  });
}

function createServerSender(options: ServerSenderOptions = {}): ServerSender {
  const deliveries: Delivery[] = [];
  const failures: { clientLocalId: string; message: string }[] = [];
  let inFlight = 0;
  const inFlightWaiters: { count: number; resolve: () => void }[] = [];

  function noteInFlight(delta: number): void {
    inFlight += delta;
    for (let i = inFlightWaiters.length - 1; i >= 0; i -= 1) {
      const waiter = inFlightWaiters[i];
      if (waiter && inFlight >= waiter.count) {
        inFlightWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  const send: OutboxSender = async (procedure, input) => {
    const clientLocalId = readString(input, 'clientLocalId');
    // Recorded on ENTRY, before anything can fail or be delayed. A second
    // claim of the same row shows up here even if its send never lands.
    deliveries.push({ procedure, clientLocalId });
    noteInFlight(1);
    try {
      await waitTicks(options.delayTicks?.({ procedure, clientLocalId }) ?? 0);
      if (options.gate) await options.gate;
      if (options.conflicting?.has(clientLocalId)) throw conflictError();
      return await applyMutation(procedure, input, clientLocalId);
    } catch (error) {
      if (!(error instanceof Error) || !('data' in error)) {
        failures.push({
          clientLocalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      noteInFlight(-1);
    }
  };

  return {
    send,
    deliveries,
    failures,
    whenInFlight: (count) =>
      inFlight >= count
        ? Promise.resolve()
        : new Promise((resolve) => {
            inFlightWaiters.push({ count, resolve });
          }),
  };
}

/**
 * The server half of each procedure the outbox knows how to send, written
 * exactly as a real resolver would: through `offlineUpsert` against the
 * table's own `(client_id, client_local_id)` index, never a plain insert.
 * `phase-09` and `phase-13` fill in the real procedures; this is the same
 * statement they will emit.
 */
async function applyMutation(
  procedure: string,
  input: Payload,
  clientLocalId: string,
): Promise<unknown> {
  switch (procedure) {
    case 'workouts.startSession':
      return offlineUpsert(db, {
        table: schema.workoutSessions,
        values: {
          clientId: clientProfileId,
          coachId: coachProfileId,
          scheduledDate: readString(input, 'scheduledDate'),
          status: 'in_progress',
          startedAt: readDate(input, 'startedAt'),
          clientLocalId,
        },
        target: [schema.workoutSessions.clientId, schema.workoutSessions.clientLocalId],
        onConflict: 'update',
      });

    case 'workouts.logSet': {
      // DB§14.2's ordering rule, made load-bearing rather than asserted
      // afterwards: a set cannot be written without its session's SERVER
      // id, so a set that outruns its session fails loudly here.
      const sessionClientLocalId = readString(input, 'sessionClientLocalId');
      const [session] = await db
        .select({ id: schema.workoutSessions.id })
        .from(schema.workoutSessions)
        .where(
          and(
            eq(schema.workoutSessions.clientId, clientProfileId),
            eq(schema.workoutSessions.clientLocalId, sessionClientLocalId),
          ),
        )
        .limit(1);
      if (!session) {
        throw new Error(
          `ordering violated: set ${clientLocalId} reached the server before session ${sessionClientLocalId}`,
        );
      }
      return offlineUpsert(db, {
        table: schema.setLogs,
        values: {
          workoutSessionId: session.id,
          exerciseId,
          clientId: clientProfileId,
          setNumber: readNumber(input, 'setNumber'),
          reps: readNumber(input, 'reps'),
          weightKg: readString(input, 'weightKg'),
          loggedAt: readDate(input, 'loggedAt'),
          clientLocalId,
        },
        target: [schema.setLogs.clientId, schema.setLogs.clientLocalId],
        onConflict: 'update',
      });
    }

    case 'nutrition.logMeal':
      return offlineUpsert(db, {
        table: schema.meals,
        values: {
          clientId: clientProfileId,
          coachId: coachProfileId,
          loggedDate: readString(input, 'loggedDate'),
          mealType: 'lunch',
          loggedAt: readDate(input, 'loggedAt'),
          clientLocalId,
        },
        target: [schema.meals.clientId, schema.meals.clientLocalId],
        onConflict: 'update',
      });

    default:
      throw new Error(`no server handler for ${procedure}`);
  }
}

// ─── The queue under test ────────────────────────────────────────────────

interface QueuedWork {
  sessionClientLocalId: string;
  sessionOutboxId: string;
  setClientLocalIds: string[];
  mealClientLocalId: string;
  /** Every `clientLocalId` enqueued, in enqueue order. */
  all: string[];
}

/**
 * A realistic outbox: one session, several sets chained to it, and a meal
 * hanging off nothing. Two chains, so one run exercises DB§14.2's strict
 * order WITHIN a chain and its parallelism ACROSS chains at the same time.
 */
async function queueRealisticWork(iteration: number): Promise<QueuedWork> {
  const scheduledDate = '2026-09-08';
  const session = await enqueueMutation({
    procedure: 'workouts.startSession',
    payload: { scheduledDate, startedAt: new Date(FIXED_NOW) },
  });

  const setClientLocalIds: string[] = [];
  for (let setNumber = 1; setNumber <= SETS_PER_SESSION; setNumber += 1) {
    const set = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {
        sessionClientLocalId: session.clientLocalId,
        setNumber,
        reps: 5,
        weightKg: `${100 + iteration}.00`,
        loggedAt: new Date(FIXED_NOW + setNumber * 1_000),
      },
      dependsOn: session.outboxId,
    });
    setClientLocalIds.push(set.clientLocalId);
  }

  const meal = await enqueueMutation({
    procedure: 'nutrition.logMeal',
    payload: { loggedDate: scheduledDate, loggedAt: new Date(FIXED_NOW) },
  });

  return {
    sessionClientLocalId: session.clientLocalId,
    sessionOutboxId: session.outboxId,
    setClientLocalIds,
    mealClientLocalId: meal.clientLocalId,
    all: [session.clientLocalId, ...setClientLocalIds, meal.clientLocalId],
  };
}

// ─── Racing drains ───────────────────────────────────────────────────────

/**
 * Drains the outbox using `runFlushPass` rather than `flushOutbox`.
 *
 * Deliberate, and the point of the whole file: `flushOutbox` joins a running
 * flush's promise (`flush.ts` layer 1), so two concurrent calls to it can
 * never race by construction — a green result there says nothing about the
 * claim. `runFlushPass` is exported precisely to bypass that promise and
 * leave the transactional `'inflight'` claim (layer 2) as the sole defence.
 * Two of these loops running against one database is the real adversary.
 */
async function racingDrain(
  localDb: LocalDb,
  options: { send: OutboxSender },
  isSettled: () => Promise<boolean>,
): Promise<number> {
  let claimed = 0;
  // Bounded so a genuine deadlock fails the test instead of hanging CI.
  for (let pass = 0; pass < 1_000; pass += 1) {
    const result = await runFlushPass(localDb, FIXED_NOW, options);
    claimed += result.claimed;
    if (result.claimed === 0) {
      if (await isSettled()) return claimed;
      // Nothing claimable yet — the sibling loop holds the chain's parent.
      // A real macrotask, so its IO can actually complete.
      await tick();
    }
  }
  throw new Error('racingDrain did not settle within 1000 passes');
}

type OutboxRow = Record<string, unknown>;

async function readOutbox(localDb: LocalDb): Promise<OutboxRow[]> {
  return localDb.all<OutboxRow>(sql`SELECT * FROM outbox`);
}

/** Every row is `done`, or terminally failed — nothing left for any loop to do. */
function settled(localDb: LocalDb): () => Promise<boolean> {
  return async () => {
    const rows = await readOutbox(localDb);
    return rows.every((row) => row.status === 'done' || Number(row.attempts ?? 0) >= MAX_ATTEMPTS);
  };
}

// ─── Assertions ──────────────────────────────────────────────────────────

/**
 * The single-flight assertion. Formatted as a list rather than a count so a
 * failure names the offending mutations — trace each one back to
 * `claimReadyEntries` in `flush.ts` (see this file's header).
 */
function duplicateDeliveries(deliveries: Delivery[]): { clientLocalId: string; sends: number }[] {
  const counts = new Map<string, { procedure: string; sends: number }>();
  for (const delivery of deliveries) {
    const seen = counts.get(delivery.clientLocalId);
    if (seen) seen.sends += 1;
    else counts.set(delivery.clientLocalId, { procedure: delivery.procedure, sends: 1 });
  }
  return [...counts]
    .filter(([, seen]) => seen.sends > 1)
    .map(([clientLocalId, seen]) => ({ clientLocalId, sends: seen.sends }));
}

async function sessionIdFor(clientLocalId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.workoutSessions.id })
    .from(schema.workoutSessions)
    .where(
      and(
        eq(schema.workoutSessions.clientId, clientProfileId),
        eq(schema.workoutSessions.clientLocalId, clientLocalId),
      ),
    );
  return rows.map((row) => row.id);
}

async function setRowsFor(
  clientLocalIds: readonly string[],
): Promise<{ clientLocalId: string; id: string; workoutSessionId: string }[]> {
  if (clientLocalIds.length === 0) return [];
  // One query, never one per set (`code-conventions` §7) — at 30 sets ×
  // 20 iterations the per-row version is 600 round trips of pure overhead.
  return db
    .select({
      clientLocalId: schema.setLogs.clientLocalId,
      id: schema.setLogs.id,
      workoutSessionId: schema.setLogs.workoutSessionId,
    })
    .from(schema.setLogs)
    .where(
      and(
        eq(schema.setLogs.clientId, clientProfileId),
        inArray(schema.setLogs.clientLocalId, [...clientLocalIds]),
      ),
    );
}

async function mealIdsFor(clientLocalId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.meals.id })
    .from(schema.meals)
    .where(
      and(
        eq(schema.meals.clientId, clientProfileId),
        eq(schema.meals.clientLocalId, clientLocalId),
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Exactly one server row per enqueued mutation, and every set attached to
 * the one session row — the exit gate's own wording, checked per
 * `client_local_id` so accumulated rows from earlier iterations cannot
 * accidentally satisfy it.
 */
async function expectExactlyOneRowEach(work: QueuedWork): Promise<void> {
  const sessionIds = await sessionIdFor(work.sessionClientLocalId);
  expect(sessionIds).toHaveLength(1);
  const sessionId = sessionIds[0];

  const setRows = await setRowsFor(work.setClientLocalIds);
  // Every set present, exactly once, and every one attached to the single
  // session row — DB§14.2's ordering outcome, not just its mechanism.
  expect(setRows).toHaveLength(work.setClientLocalIds.length);
  expect(new Set(setRows.map((row) => row.clientLocalId)).size).toBe(setRows.length);
  expect(new Set(setRows.map((row) => row.workoutSessionId))).toEqual(new Set([sessionId]));

  expect(await mealIdsFor(work.mealClientLocalId)).toHaveLength(1);
}

// ─── 1 · The exit gate, exactly as stated ────────────────────────────────

describe('flushing the outbox twice concurrently', () => {
  it('creates zero duplicate server rows across a dependency chain and an independent mutation', async () => {
    const localDb = await getLocalDb();
    const work = await queueRealisticWork(0);
    const sender = createServerSender({ delayTicks: () => 1 });

    // The literal acceptance criterion: two triggers overlapping — app
    // foreground and connectivity regain (`offline-sync` §4).
    const [first, second] = await Promise.all([
      flushOutbox({ send: sender.send, now: () => FIXED_NOW }),
      flushOutbox({ send: sender.send, now: () => FIXED_NOW }),
    ]);

    expect(sender.failures).toEqual([]);
    expect(duplicateDeliveries(sender.deliveries)).toEqual([]);
    expect(sender.deliveries).toHaveLength(work.all.length);
    await expectExactlyOneRowEach(work);

    // Layer 1: the second call joined the first rather than starting a
    // second loop, so both observe the same tally.
    expect(second).toEqual(first);
    expect(first.sent).toBe(work.all.length);
    expect(first.failed).toBe(0);

    const rows = await readOutbox(localDb);
    expect(rows.map((row) => row.status)).toEqual(rows.map(() => 'done'));
  });
});

// ─── 2 · The adversarial race, with layer 1 removed ──────────────────────

describe('two independent flush loops racing one outbox', () => {
  it(`produces one row and one send per mutation across ${RACE_ITERATIONS} iterations`, async () => {
    const claimsPerLoop = [0, 0];

    for (let iteration = 0; iteration < RACE_ITERATIONS; iteration += 1) {
      resetLocalDbForTests();
      resetOutboxFlushStateForTests();
      sqliteFake.__reset();

      const localDb = await getLocalDb();
      const work = await queueRealisticWork(iteration);
      // The window between claiming a row and marking it done is widened by
      // a different amount each iteration, and differently per mutation, so
      // the two loops interleave at a different point every time instead of
      // repeating one schedule the event loop happens to make safe.
      const sender = createServerSender({
        delayTicks: ({ clientLocalId }) => (iteration + clientLocalId.charCodeAt(0)) % 4,
      });
      const options = { send: sender.send };
      const isSettled = settled(localDb);

      const [claimedByFirst, claimedBySecond] = await Promise.all([
        racingDrain(localDb, options, isSettled),
        racingDrain(localDb, options, isSettled),
      ]);
      claimsPerLoop[0] = (claimsPerLoop[0] ?? 0) + claimedByFirst;
      claimsPerLoop[1] = (claimsPerLoop[1] ?? 0) + claimedBySecond;

      expect({ iteration, failures: sender.failures }).toEqual({ iteration, failures: [] });
      expect({ iteration, duplicates: duplicateDeliveries(sender.deliveries) }).toEqual({
        iteration,
        duplicates: [],
      });
      expect(sender.deliveries).toHaveLength(work.all.length);
      await expectExactlyOneRowEach(work);
    }

    // The test proving its own adversary. If the second loop never claims a
    // row, every green above only means "the second loop found everything
    // already `'inflight'`" — real, but half the guard. This asserts the
    // loops genuinely partitioned the queue, and fails loudly if a future
    // change to `FLUSH_BATCH_SIZE` or the claim's shape quietly closes the
    // window this whole file depends on.
    expect(claimsPerLoop[0]).toBeGreaterThan(0);
    expect(claimsPerLoop[1]).toBeGreaterThan(0);
    expect((claimsPerLoop[0] ?? 0) + (claimsPerLoop[1] ?? 0)).toBe(
      RACE_ITERATIONS * (SETS_PER_SESSION + 2),
    );
  });

  it('never lets a second loop claim a row the first is still sending', async () => {
    const localDb = await getLocalDb();
    const work = await queueRealisticWork(100);

    // Every send parks on this gate, so the first loop is genuinely
    // mid-flight — not merely started — when the second loop begins.
    let openGate = (): void => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const sender = createServerSender({ gate });
    const options = { send: sender.send };
    const isSettled = settled(localDb);

    const first = racingDrain(localDb, options, isSettled);
    await sender.whenInFlight(1);

    // The session is claimed and in flight. A whole pass by a second loop
    // must claim nothing: the session is `'inflight'`, and every set is
    // blocked behind a parent that is not yet `'done'`.
    const midFlightPass = await runFlushPass(localDb, FIXED_NOW, options);
    expect(midFlightPass).toEqual({ claimed: 0, sent: 0, failed: 0 });

    const second = racingDrain(localDb, options, isSettled);
    openGate();
    await Promise.all([first, second]);

    expect(sender.failures).toEqual([]);
    expect(duplicateDeliveries(sender.deliveries)).toEqual([]);
    expect(sender.deliveries).toHaveLength(work.all.length);
    await expectExactlyOneRowEach(work);
  });
});

// ─── 3 · A 409 in the middle of a race ───────────────────────────────────

/** The device-mirror rows a conflict has to mark (DB§14.4). Raw SQL, as `flush.test.ts` does. */
async function seedMirrorRows(work: QueuedWork): Promise<void> {
  const localDb = await getLocalDb();
  localDb.run(
    sql`INSERT INTO local_workout_sessions (id, client_local_id, scheduled_date, status, payload_json, sync_state, updated_at) VALUES (${work.sessionClientLocalId}, ${work.sessionClientLocalId}, ${'2026-09-08'}, ${'in_progress'}, ${'{}'}, ${'pending'}, ${FIXED_NOW})`,
  );
  for (const [index, clientLocalId] of work.setClientLocalIds.entries()) {
    localDb.run(
      sql`INSERT INTO local_set_logs (id, client_local_id, session_local_id, exercise_id, set_number, logged_at, sync_state) VALUES (${clientLocalId}, ${clientLocalId}, ${work.sessionClientLocalId}, ${'exercise-1'}, ${index + 1}, ${FIXED_NOW}, ${'pending'})`,
    );
  }
}

describe('a 409 racing the rest of the queue', () => {
  it('takes the conflicted row out of the retry loop without disturbing any other mutation', async () => {
    const localDb = await getLocalDb();
    const work = await queueRealisticWork(200);
    await seedMirrorRows(work);

    const conflicted = work.setClientLocalIds[0];
    if (conflicted === undefined) throw new Error('fixture: no set to conflict');

    const sender = createServerSender({
      conflicting: new Set([conflicted]),
      delayTicks: () => 1,
    });
    const options = { send: sender.send };
    const isSettled = settled(localDb);

    await Promise.all([
      racingDrain(localDb, options, isSettled),
      racingDrain(localDb, options, isSettled),
    ]);

    expect(sender.failures).toEqual([]);
    expect(duplicateDeliveries(sender.deliveries)).toEqual([]);

    // DB§14.4: `'done'` (the outbox is finished with it), `SYNC_CONFLICT` in
    // `last_error`, and `attempts` untouched — a 409 is a definitive answer,
    // not a failure to retry and not a strike against the failure banner.
    const rows = await readOutbox(localDb);
    const conflictedRow = rows.find((row) => row.client_local_id === conflicted);
    expect(conflictedRow).toMatchObject({
      status: 'done',
      last_error: 'SYNC_CONFLICT',
      attempts: 0,
    });

    const mirror = localDb
      .all<Record<string, unknown>>(sql`SELECT * FROM local_set_logs`)
      .find((row) => row.client_local_id === conflicted);
    expect(mirror?.sync_state).toBe('conflict');

    // The idempotency guarantee is untouched for everything else: one row
    // each, and the sets that did land still point at the one session row.
    const sessionIds = await sessionIdFor(work.sessionClientLocalId);
    expect(sessionIds).toHaveLength(1);
    const setRows = await setRowsFor(work.setClientLocalIds);
    expect(setRows.map((row) => row.clientLocalId).sort()).toEqual(
      work.setClientLocalIds.filter((id) => id !== conflicted).sort(),
    );
    expect(new Set(setRows.map((row) => row.workoutSessionId))).toEqual(new Set([sessionIds[0]]));
    expect(await mealIdsFor(work.mealClientLocalId)).toHaveLength(1);
  });
});
