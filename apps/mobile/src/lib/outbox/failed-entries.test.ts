import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { enqueueMutation } from './enqueue.ts';
import { readFailedOutboxEntries, retryFailedOutboxEntries } from './failed-entries.ts';
import { MAX_ATTEMPTS, resetOutboxFlushStateForTests, type OutboxSender } from './flush.ts';

jest.mock('../analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asProcedureName: (path: string) => path,
}));

// The same hand-built `expo-sqlite` fake `flush.test.ts` runs against —
// shared, not re-declared, so the two suites cannot disagree about what
// SQLite does.
type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('./__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

const FIXED_NOW = Date.now() + 60_000;

async function readOutbox(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM outbox`);
}

/** Drives a row to a state only the flush loop normally produces. */
async function forceRow(outboxId: string, changes: Record<string, unknown>): Promise<void> {
  const db = await getLocalDb();
  for (const [column, value] of Object.entries(changes)) {
    db.run(sql`UPDATE outbox SET ${sql.raw(`"${column}"`)} = ${value} WHERE id = ${outboxId}`);
  }
}

/** Enqueues a row and drives it straight to DB§14.4's terminal state. */
async function enqueueStuck(procedure: string, createdAt?: number): Promise<string> {
  const { outboxId } = await enqueueMutation({ procedure, payload: {} });
  await forceRow(outboxId, {
    status: 'failed',
    attempts: MAX_ATTEMPTS,
    last_error: 'NETWORK_ERROR',
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
  });
  return outboxId;
}

beforeEach(() => {
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  sqliteFake.__reset();
});

describe('readFailedOutboxEntries', () => {
  it('reports nothing when no row has exhausted its attempts', async () => {
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await expect(readFailedOutboxEntries()).resolves.toEqual({ totalCount: 0, groups: [] });
  });

  it('ignores a row that is still retrying, however many times it has failed', async () => {
    const { outboxId } = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(outboxId, { status: 'failed', attempts: MAX_ATTEMPTS - 1 });

    // Attempts 1–9 are a backing-off row, not a failure the client is told
    // about — surfacing one would announce a problem that resolves itself.
    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 0 });
  });

  it('ignores a conflicted row, which reached the server and is not stuck here', async () => {
    const { outboxId } = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(outboxId, { status: 'done', last_error: 'SYNC_CONFLICT' });

    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 0 });
  });

  it('groups stuck rows by procedure, in the client language, newest first', async () => {
    await enqueueStuck('workouts.logSet', 1_000);
    await enqueueStuck('workouts.logSet', 2_000);
    await enqueueStuck('nutrition.logMeal', 3_000);

    const summary = await readFailedOutboxEntries();

    expect(summary.totalCount).toBe(3);
    expect(summary.groups).toEqual([
      { procedure: 'nutrition.logMeal', label: 'Meals', count: 1, lastQueuedAt: 3_000 },
      { procedure: 'workouts.logSet', label: 'Logged sets', count: 2, lastQueuedAt: 2_000 },
    ]);
  });

  it('labels a procedure nobody has named without dropping it from the list', async () => {
    await enqueueStuck('habits.somethingNew', 5_000);

    const summary = await readFailedOutboxEntries();

    expect(summary.totalCount).toBe(1);
    expect(summary.groups[0]?.label).toBe('Other entries');
  });
});

describe('retryFailedOutboxEntries', () => {
  /** A sender that records what it was asked to send. */
  function recordingSender(): { send: OutboxSender; calls: string[] } {
    const calls: string[] = [];
    const send: OutboxSender = async (procedure) => {
      calls.push(procedure);
      return null;
    };
    return { send, calls };
  }

  it('puts every stuck row back through the ordinary flush loop', async () => {
    const stuck = await enqueueStuck('workouts.logSet');
    const { send, calls } = recordingSender();

    const retried = await retryFailedOutboxEntries({ send, now: () => FIXED_NOW });

    expect(retried).toBe(1);
    // The point of the reset: no bespoke send path, so the row syncs the
    // same way it would have on a connectivity regain.
    expect(calls).toEqual(['workouts.logSet']);
    const row = (await readOutbox()).find((r) => r.id === stuck);
    expect(row).toMatchObject({ status: 'done' });
  });

  it('resets attempts, status and next_attempt_at before flushing', async () => {
    const stuck = await enqueueStuck('workouts.logSet');
    // A sender that fails once lets the reset itself be observed: the row
    // is re-queued, tried, and lands back on attempt 1 rather than 11.
    const send: OutboxSender = async () => {
      throw new Error('still down');
    };

    await retryFailedOutboxEntries({ send, now: () => FIXED_NOW });

    expect((await readOutbox()).find((r) => r.id === stuck)).toMatchObject({
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 1_000,
    });
  });

  it('leaves a still-retrying row untouched', async () => {
    const { outboxId } = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(outboxId, {
      status: 'failed',
      attempts: 3,
      next_attempt_at: FIXED_NOW + 60_000,
    });
    const { send } = recordingSender();

    const retried = await retryFailedOutboxEntries({ send, now: () => FIXED_NOW });

    expect(retried).toBe(0);
    expect((await readOutbox()).find((r) => r.id === outboxId)).toMatchObject({ attempts: 3 });
  });

  it('recovers a whole chain stranded behind one stuck row, parent first', async () => {
    // S31: the count grew to include rows that were never sent. The recovery
    // did not have to change — re-queueing the exhausted root is enough,
    // because the ordinary flush loop takes the children with it — and this
    // proves that is still true now that those children are counted.
    const session = await enqueueStuck('workouts.startSession');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {}, dependsOn: session });
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {}, dependsOn: session });
    const { send, calls } = recordingSender();

    expect((await readFailedOutboxEntries()).totalCount).toBe(3);
    await retryFailedOutboxEntries({ send, now: () => FIXED_NOW });

    expect(calls).toEqual(['workouts.startSession', 'workouts.logSet', 'workouts.logSet']);
    expect((await readOutbox()).map((r) => r.status)).toEqual(['done', 'done', 'done']);
    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 0 });
  });

  it('never deletes an entry, whatever happens to it', async () => {
    const stuck = await enqueueStuck('workouts.logSet');
    const send: OutboxSender = async () => {
      throw new Error('still down');
    };

    await retryFailedOutboxEntries({ send, now: () => FIXED_NOW });

    // DB§14.4 forbids dropping an entry. A retry that failed again must
    // still be queryable and actionable.
    expect((await readOutbox()).map((r) => r.id)).toContain(stuck);
  });
});

// S31. A child whose `depends_on` never reached `'done'` is never claimed, so
// it never sends, so `attempts` stays 0 — invisible to a predicate that only
// looks at the ceiling, while being exactly as stuck as the row blocking it.
describe('readFailedOutboxEntries — rows stranded behind a stuck row', () => {
  /** A session-start plus `setCount` set-logs chained to it — P09's real shape (DB§14.2). */
  async function enqueueSessionChain(setCount: number): Promise<string> {
    const session = await enqueueMutation({
      procedure: 'workouts.startSession',
      payload: {},
    });
    for (let i = 0; i < setCount; i += 1) {
      await enqueueMutation({
        procedure: 'workouts.logSet',
        payload: {},
        dependsOn: session.outboxId,
      });
    }
    return session.outboxId;
  }

  it('counts every set stranded behind a session that exhausted its attempts', async () => {
    const session = await enqueueSessionChain(30);
    await forceRow(session, { status: 'failed', attempts: MAX_ATTEMPTS });

    const summary = await readFailedOutboxEntries();

    // The gym-basement case: "1 item couldn't be saved" is wrong by thirty.
    expect(summary.totalCount).toBe(31);
    expect(summary.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ procedure: 'workouts.logSet', count: 30 }),
        expect.objectContaining({ procedure: 'workouts.startSession', count: 1 }),
      ]),
    );
  });

  it('reaches a grandchild, not only the direct dependents of the stuck row', async () => {
    const start = await enqueueMutation({ procedure: 'workouts.startSession', payload: {} });
    const complete = await enqueueMutation({
      procedure: 'workouts.complete',
      payload: {},
      dependsOn: start.outboxId,
    });
    await enqueueMutation({
      procedure: 'workouts.updateNotes',
      payload: {},
      dependsOn: complete.outboxId,
    });
    await forceRow(start.outboxId, { status: 'failed', attempts: MAX_ATTEMPTS });

    // A single join would report 2. Nothing in the chain can move until the
    // root does, so all three are stuck.
    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 3 });
  });

  it('ignores a row waiting on a parent that is still retrying', async () => {
    const session = await enqueueMutation({ procedure: 'workouts.startSession', payload: {} });
    await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: session.outboxId,
    });
    await forceRow(session.outboxId, { status: 'failed', attempts: MAX_ATTEMPTS - 1 });

    // The parent will very likely win its next attempt, and the child goes
    // with it. Only a chain rooted at a genuinely exhausted row is stuck.
    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 0 });
  });

  it('ignores a row whose parent already synced', async () => {
    const session = await enqueueMutation({ procedure: 'workouts.startSession', payload: {} });
    await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: session.outboxId,
    });
    await forceRow(session.outboxId, { status: 'done' });

    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 0 });
  });

  it('counts a row once when it is both exhausted and stranded behind another', async () => {
    const session = await enqueueMutation({ procedure: 'workouts.startSession', payload: {} });
    const set = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: session.outboxId,
    });
    await forceRow(session.outboxId, { status: 'failed', attempts: MAX_ATTEMPTS });
    await forceRow(set.outboxId, { status: 'failed', attempts: MAX_ATTEMPTS });

    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 2 });
  });

  it('terminates on a dependency cycle instead of walking it forever', async () => {
    // `depends_on` should never form a cycle — `enqueueMutation` only ever
    // points a new row at an existing one. A corrupt or hand-edited row is
    // the reachable way in, and a banner that hangs the app on one is a
    // worse failure than the undercount this predicate fixes.
    const first = await enqueueMutation({ procedure: 'workouts.startSession', payload: {} });
    const second = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: first.outboxId,
    });
    await forceRow(first.outboxId, {
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      depends_on: second.outboxId,
    });

    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 2 });
  });

  it('terminates on a row that depends on itself', async () => {
    const only = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(only.outboxId, {
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      depends_on: only.outboxId,
    });

    await expect(readFailedOutboxEntries()).resolves.toMatchObject({ totalCount: 1 });
  });
});
