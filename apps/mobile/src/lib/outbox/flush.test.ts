import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { enqueueMutation } from './enqueue.ts';
import {
  claimReadyEntries,
  flushOutbox,
  MAX_ATTEMPTS,
  resetOutboxFlushStateForTests,
  runFlushPass,
  type OutboxSender,
} from './flush.ts';
import {
  resetOutboxResultListenersForTests,
  subscribeOutboxResults,
  type OutboxSendResult,
} from './results.ts';

// `trackEvent` fires on the ceiling transition (`ANALYTICS.md` AN§3.8's
// `sync_failed`). Mocked rather than exercised: the real module reaches
// PostHog's native client, and what this file is asserting is that the
// event fires once with the right shape, which is the seam's whole job.
jest.mock('../analytics/index.ts', () => ({
  trackEvent: jest.fn(),
  asProcedureName: (path: string) => path,
}));

// `expo-sqlite` has no Jest-side native module, so these tests run against
// the hand-built fake in `__fixtures__/sqlite-fake.ts` — see its header for
// what it does and does not implement. Jest hoists `jest.mock()` above every
// import and its factory may not close over an out-of-scope value, but it
// may `require`, which is how one definition serves two suites.
type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('./__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as {
  __reset: () => void;
  __failNextWrite: (message: string) => void;
};

const analytics = jest.requireMock('../analytics/index.ts') as { trackEvent: jest.Mock };

// Ahead of the wall clock `enqueueMutation` stamps rows with, so an
// freshly-enqueued row is always due by the time the flush loop looks.
const FIXED_NOW = Date.now() + 60_000;

// Raw `SELECT *` hands back snake_case columns, which Drizzle's camelCase
// `$inferSelect` does not describe — so these rows stay deliberately untyped
// rather than hand-writing a second row shape (`code-conventions` §3).
async function readOutbox(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM outbox`);
}

async function readRow(outboxId: string): Promise<Row | undefined> {
  const rows = await readOutbox();
  return rows.find((r) => r.id === outboxId);
}

/**
 * Puts a row into a state only the flush loop itself normally produces.
 * Direct SQL, in the one folder `outbox/no-direct-outbox-write` exempts —
 * these tests are the files that check the table.
 */
async function forceRow(
  outboxId: string,
  changes: Partial<Record<string, unknown>>,
): Promise<void> {
  const db = await getLocalDb();
  for (const [column, value] of Object.entries(changes)) {
    db.run(sql`UPDATE outbox SET ${sql.raw(`"${column}"`)} = ${value} WHERE id = ${outboxId}`);
  }
}

/** A sender that records what it was asked to send, instead of reaching the network. */
function recordingSender(): { send: OutboxSender; calls: { procedure: string; input: Row }[] } {
  const calls: { procedure: string; input: Row }[] = [];
  const send: OutboxSender = async (procedure, input) => {
    calls.push({ procedure, input });
    return null;
  };
  return { send, calls };
}

/** A sender that always fails, counting its attempts. */
function failingSender(message: string) {
  return jest.fn<ReturnType<OutboxSender>, Parameters<OutboxSender>>(async () => {
    throw new Error(message);
  });
}

/**
 * A sender that answers with a genuine conflict. Shaped like what the tRPC
 * client actually throws — `data.httpStatus` and `data.code` come from
 * tRPC's own shape, `appCode` from `apps/api`'s error formatter — rather
 * than a bespoke marker the production code could only recognise here.
 */
function conflictingSender(data: Record<string, unknown>) {
  return jest.fn<ReturnType<OutboxSender>, Parameters<OutboxSender>>(async () => {
    throw Object.assign(new Error('conflict'), { data });
  });
}

/** A device-mirror set log, the row a conflict has to mark. Raw SQL, as the rest of this file's fixtures are. */
async function seedMirrorSetLog(clientLocalId: string): Promise<void> {
  const db = await getLocalDb();
  db.run(
    sql`INSERT INTO local_workout_sessions (id, client_local_id, scheduled_date, status, payload_json, sync_state, updated_at) VALUES (${'session-1'}, ${'session-1'}, ${'2026-09-08'}, ${'in_progress'}, ${'{}'}, ${'pending'}, ${1_757_000_000_000})`,
  );
  db.run(
    sql`INSERT INTO local_set_logs (id, client_local_id, session_local_id, exercise_id, set_number, logged_at, sync_state) VALUES (${clientLocalId}, ${clientLocalId}, ${'session-1'}, ${'exercise-1'}, ${1}, ${1_757_000_000_500}, ${'pending'})`,
  );
}

async function readMirrorSetLog(clientLocalId: string): Promise<Row | undefined> {
  const db = await getLocalDb();
  const rows = db.all<Row>(sql`SELECT * FROM local_set_logs`);
  return rows.find((r) => r.client_local_id === clientLocalId);
}

beforeEach(() => {
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  resetOutboxResultListenersForTests();
  sqliteFake.__reset();
  analytics.trackEvent.mockClear();
});

// `personal-records/03`. The loop discards every response but one:
// `workouts.logSet.newPersonalRecords` is computed inside the server's write
// transaction and the device cannot know it, so `./results.ts` is the single
// seam by which a response leaves this file.
describe('delivered responses', () => {
  it('announces what a delivered mutation returned, with the input it was sent', async () => {
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { sessionClientLocalId: 'session-1', reps: 5 },
    });
    const delivered: OutboxSendResult[] = [];
    subscribeOutboxResults((sent) => delivered.push(sent));
    const send: OutboxSender = async () => ({ newPersonalRecords: ['max_weight'] });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(delivered).toEqual([
      {
        procedure: 'workouts.logSet',
        clientLocalId: enqueued.clientLocalId,
        input: {
          sessionClientLocalId: 'session-1',
          reps: 5,
          clientLocalId: enqueued.clientLocalId,
        },
        result: { newPersonalRecords: ['max_weight'] },
      },
    ]);
  });

  it('says nothing about a send that failed', async () => {
    await enqueueMutation({ procedure: 'workouts.logSet', payload: { reps: 5 } });
    const delivered: OutboxSendResult[] = [];
    subscribeOutboxResults((sent) => delivered.push(sent));

    await flushOutbox({ send: failingSender('offline'), now: () => FIXED_NOW });

    expect(delivered).toHaveLength(0);
  });

  it('keeps a delivered mutation done when a listener throws', async () => {
    // A listener is UI code. It must not be able to turn a mutation the
    // server already applied into a retry (`./results.ts` rule (b)).
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: { reps: 5 } });
    subscribeOutboxResults(() => {
      throw new Error('a bug in a celebration');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await flushOutbox({ send: recordingSender().send, now: () => FIXED_NOW });

    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(await readRow(enqueued.outboxId)).toMatchObject({ status: 'done', attempts: 0 });
    warn.mockRestore();
  });
});

describe('claimReadyEntries', () => {
  it('claims a queued row and marks it inflight in the same transaction as the read', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: { reps: 5 } });
    const db = await getLocalDb();

    const claimed = claimReadyEntries(db, FIXED_NOW);

    expect(claimed.map((e) => e.id)).toEqual([enqueued.outboxId]);
    expect((await readRow(enqueued.outboxId))?.status).toBe('inflight');
  });

  it('does not claim a row already marked inflight', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'inflight' });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
  });

  it('does not claim a row whose depends_on parent has not synced', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    const db = await getLocalDb();

    const claimed = claimReadyEntries(db, FIXED_NOW);

    expect(claimed.map((e) => e.id)).toEqual([parent.outboxId]);
    expect((await readRow(child.outboxId))?.status).toBe('queued');
  });

  it('claims a row whose depends_on parent is done', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    await forceRow(parent.outboxId, { status: 'done' });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW).map((e) => e.id)).toEqual([child.outboxId]);
  });

  it('claims a failed row only once its next_attempt_at is due', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, {
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 1_000,
    });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
    expect(claimReadyEntries(db, FIXED_NOW + 1_000).map((e) => e.id)).toEqual([enqueued.outboxId]);
  });

  it('never claims a row that has exhausted its attempts', async () => {
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'failed', attempts: 10 });
    const db = await getLocalDb();

    expect(claimReadyEntries(db, FIXED_NOW)).toEqual([]);
  });

  it('hands one row to exactly one of two concurrent claims', async () => {
    const first = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
    });
    const second = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 2 },
    });
    const db = await getLocalDb();

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => claimReadyEntries(db, FIXED_NOW)),
      Promise.resolve().then(() => claimReadyEntries(db, FIXED_NOW)),
    ]);

    const claimedIds = [...a, ...b].map((e) => e.id);
    expect(claimedIds.sort()).toEqual([first.outboxId, second.outboxId].sort());
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });
});

describe('flushOutbox', () => {
  it('sends every ready row and marks it done', async () => {
    const { send, calls } = recordingSender();
    const first = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
    });
    const second = await enqueueMutation({
      procedure: 'nutrition.logMeal',
      payload: { kcal: 400 },
    });

    const result = await flushOutbox({ send, now: () => FIXED_NOW });

    expect(result).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(calls.map((c) => c.procedure).sort()).toEqual(['nutrition.logMeal', 'workouts.logSet']);
    expect((await readRow(first.outboxId))?.status).toBe('done');
    expect((await readRow(second.outboxId))?.status).toBe('done');
  });

  it('sends the row clientLocalId as part of the procedure input', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1, reps: 5 },
    });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls[0]?.input).toEqual({
      setNumber: 1,
      reps: 5,
      clientLocalId: enqueued.clientLocalId,
    });
  });

  it('overrides a clientLocalId a payload happens to carry with the row own id', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { clientLocalId: 'not-the-real-one' },
    });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls[0]?.input.clientLocalId).toBe(enqueued.clientLocalId);
  });

  it('sends a Date captured at action time as a Date, not a string', async () => {
    const { send, calls } = recordingSender();
    const loggedAt = new Date('2026-09-08T04:30:00.000Z');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: { loggedAt } });

    await flushOutbox({ send, now: () => FIXED_NOW });

    const sent = calls[0]?.input.loggedAt;
    expect(sent).toBeInstanceOf(Date);
    expect((sent as Date).getTime()).toBe(loggedAt.getTime());
  });

  it('schedules a retry through the backoff seam instead of retrying or dropping', async () => {
    const send = failingSender('network down');
    const backoffMs = jest.fn(() => 4_000);
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    const result = await flushOutbox({ send, now: () => FIXED_NOW, backoffMs });

    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(backoffMs).toHaveBeenCalledWith(1);
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 4_000,
    });
  });

  it('records a stable error code on failure, never the error message', async () => {
    const send = failingSender('connect ECONNREFUSED 10.0.0.1:3000');
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    const lastError = (await readRow(enqueued.outboxId))?.last_error;
    expect(typeof lastError).toBe('string');
    expect(String(lastError)).not.toContain('ECONNREFUSED');
  });

  it('rejects a malformed procedure path loudly, and does not mark the row done', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({ procedure: 'notAPath', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls).toHaveLength(0);
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      last_error: 'INVALID_PROCEDURE',
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('flushes a parent and then its dependent child in one call', async () => {
    const parent = await enqueueMutation({ procedure: 'workouts.start', payload: {} });
    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: {},
      dependsOn: parent.outboxId,
    });
    // The child's send observes the parent's row, so this asserts ordering
    // rather than merely call sequence: a set log must not reach the server
    // before the session it belongs to (DB§14.2).
    const parentStatusWhenChildSent: unknown[] = [];
    const order: string[] = [];
    const send: OutboxSender = async (procedure) => {
      order.push(procedure);
      if (procedure === 'workouts.logSet') {
        parentStatusWhenChildSent.push((await readRow(parent.outboxId))?.status);
      }
      return null;
    };

    const result = await flushOutbox({ send, now: () => FIXED_NOW });

    expect(result.sent).toBe(2);
    expect(order).toEqual(['workouts.start', 'workouts.logSet']);
    expect(parentStatusWhenChildSent).toEqual(['done']);
    expect((await readRow(child.outboxId))?.status).toBe('done');
  });

  it('sends independent chains concurrently rather than one after the other', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: (() => void)[] = [];
    const send: OutboxSender = () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<null>((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve(null);
        });
      });
    };
    await enqueueMutation({ procedure: 'workouts.start', payload: { session: 1 } });
    await enqueueMutation({ procedure: 'workouts.start', payload: { session: 2 } });

    const flushing = flushOutbox({ send, now: () => FIXED_NOW });
    await new Promise((resolve) => setImmediate(resolve));
    release.forEach((r) => r());
    await flushing;

    expect(maxInFlight).toBe(2);
  });

  it('sends no row twice when flushOutbox is called twice concurrently', async () => {
    // The Verification section, and the mechanism the phase exit gate rests
    // on: two triggers (app foreground and a connectivity regain) firing at
    // the same moment.
    const { send, calls } = recordingSender();
    const enqueued = await Promise.all([
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 1 } }),
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 2 } }),
      enqueueMutation({ procedure: 'workouts.logSet', payload: { setNumber: 3 } }),
    ]);

    await Promise.all([
      flushOutbox({ send, now: () => FIXED_NOW }),
      flushOutbox({ send, now: () => FIXED_NOW }),
    ]);

    const sentIds = calls.map((c) => c.input.clientLocalId);
    expect(sentIds.sort()).toEqual(enqueued.map((e) => e.clientLocalId).sort());
    expect(new Set(sentIds).size).toBe(3);
  });

  it('sends no row twice when a second pass starts while the first is still in flight', async () => {
    // Adversarial: this bypasses the single-flight promise entirely and runs
    // a second pass *during* the first one's send, which is the only way to
    // prove the `inflight` claim — not the mutex — is what excludes the row.
    const sent: unknown[] = [];
    let secondPass: Promise<unknown> | null = null;
    const send: OutboxSender = async (_procedure, input) => {
      sent.push(input.clientLocalId);
      if (!secondPass) {
        const db = await getLocalDb();
        secondPass = runFlushPass(db, FIXED_NOW, { send, now: () => FIXED_NOW });
        await secondPass;
      }
      return null;
    };
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    const db = await getLocalDb();
    await runFlushPass(db, FIXED_NOW, { send, now: () => FIXED_NOW });

    expect(sent).toEqual([enqueued.clientLocalId]);
    expect((await readRow(enqueued.outboxId))?.status).toBe('done');
  });

  it('retries a row left inflight by a killed app process, rather than stranding it', async () => {
    const { send, calls } = recordingSender();
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await forceRow(enqueued.outboxId, { status: 'inflight' });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(calls).toHaveLength(1);
    expect((await readRow(enqueued.outboxId))?.status).toBe('done');
  });

  it('does not retry a failed row again within the same flush run', async () => {
    const send = failingSender('network down');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW, backoffMs: () => 0 });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('claims nothing when the outbox is empty', async () => {
    const { send, calls } = recordingSender();

    await expect(flushOutbox({ send, now: () => FIXED_NOW })).resolves.toMatchObject({
      claimed: 0,
      sent: 0,
      failed: 0,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('backoff and the attempt ceiling (DB§14.4)', () => {
  // The ceiling logs one loud line by design (`observability-ops` §3);
  // silenced so a passing run stays readable, and asserted below.
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('waits 1s, 2s, 4s, 8s… doubling after every failed attempt', async () => {
    const send = failingSender('network down');
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    // No `backoffMs` override: this asserts the DEFAULT the flush loop
    // ships with, which is the acceptance criterion. The clock advances to
    // exactly the row's own `next_attempt_at`, so each run is the moment
    // the previous backoff expired.
    const delays: number[] = [];
    let clock = FIXED_NOW;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      await flushOutbox({ send, now: () => clock });
      const row = await readRow(enqueued.outboxId);
      delays.push(Number(row?.next_attempt_at) - clock);
      clock = Number(row?.next_attempt_at);
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000]);
    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });

  it('stops after exactly ten attempts and leaves the row failed, never dropped', async () => {
    const send = failingSender('network down');
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    // Well past the 5-minute cap each time, so the row is always due and
    // the only thing that can stop the loop is the ceiling itself.
    let clock = FIXED_NOW;
    for (let run = 0; run < MAX_ATTEMPTS + 3; run += 1) {
      await flushOutbox({ send, now: () => clock });
      clock += 600_000;
    }

    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
    });
    // Codes and ids only — never the error message, which can echo a payload.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('outbox.permanently_failed', {
      outboxId: enqueued.outboxId,
      procedure: 'workouts.logSet',
      attempts: MAX_ATTEMPTS,
      errorCode: 'NETWORK_ERROR',
    });
  });

  it('fires sync_failed once, at the ceiling and not before', async () => {
    const send = failingSender('network down');
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    let clock = FIXED_NOW;
    for (let run = 0; run < MAX_ATTEMPTS + 2; run += 1) {
      await flushOutbox({ send, now: () => clock });
      clock += 600_000;
    }

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).toHaveBeenCalledWith('sync_failed', {
      procedure: 'workouts.logSet',
      attempts: MAX_ATTEMPTS,
    });
  });
});

describe('conflict routing (a 409 is not a retryable failure)', () => {
  const CONFLICT_DATA = { code: 'CONFLICT', httpStatus: 409, appCode: 'SYNC_CONFLICT' };

  it('routes a 409 straight to sync_state=conflict without consuming an attempt', async () => {
    const send = conflictingSender(CONFLICT_DATA);
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await seedMirrorSetLog(enqueued.clientLocalId);

    const result = await flushOutbox({ send, now: () => FIXED_NOW });

    expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect((await readMirrorSetLog(enqueued.clientLocalId))?.sync_state).toBe('conflict');
    expect(await readRow(enqueued.outboxId)).toMatchObject({
      attempts: 0,
      last_error: 'SYNC_CONFLICT',
    });
  });

  it('warns when a conflict marks no mirror row, so it cannot vanish silently', async () => {
    const send = conflictingSender(CONFLICT_DATA);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Deliberately no `seedMirrorSetLog` — nothing carries this client_local_id,
    // so the sweep matches nothing and `sync-engine` would never see the conflict.
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(warn).toHaveBeenCalledWith('outbox.conflict_unmirrored', {
      outboxId: enqueued.outboxId,
      procedure: 'workouts.logSet',
    });
    warn.mockRestore();
  });

  it('stays silent when the conflict did mark a mirror row', async () => {
    const send = conflictingSender(CONFLICT_DATA);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });
    await seedMirrorSetLog(enqueued.clientLocalId);

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(warn).not.toHaveBeenCalledWith('outbox.conflict_unmirrored', expect.anything());
    warn.mockRestore();
  });

  it('recognises a bare 409 with no app code, since the status alone is definitive', async () => {
    const send = conflictingSender({ httpStatus: 409 });
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(await readRow(enqueued.outboxId)).toMatchObject({ attempts: 0 });
  });

  it('never re-sends a conflicted row on a later flush', async () => {
    const send = conflictingSender(CONFLICT_DATA);
    await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });
    await flushOutbox({ send, now: () => FIXED_NOW + 600_000 });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never counts a conflict toward the failure surface, however many times it happens', async () => {
    const send = conflictingSender(CONFLICT_DATA);
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    // The banner keys on `status='failed'` at the ceiling. A conflict that
    // landed there would be reported to the client as "couldn't be saved"
    // when the server has in fact answered definitively.
    expect((await readRow(enqueued.outboxId))?.status).not.toBe('failed');
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it('still backs off a 5xx, which is retryable however conflict-shaped its body is', async () => {
    const send = conflictingSender({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 });
    const enqueued = await enqueueMutation({ procedure: 'workouts.logSet', payload: {} });

    await flushOutbox({ send, now: () => FIXED_NOW });

    expect(await readRow(enqueued.outboxId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      next_attempt_at: FIXED_NOW + 1_000,
    });
  });
});
