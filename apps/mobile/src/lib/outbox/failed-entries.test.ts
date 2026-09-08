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
