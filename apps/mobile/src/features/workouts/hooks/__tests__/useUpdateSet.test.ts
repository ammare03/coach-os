import { eq, sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { logSet } from '../useLogSet.ts';
import { UPDATE_SET_PROCEDURE, updateSet } from '../useUpdateSet.ts';

// `phase-09-workout-logger/set-entry/05`. The task's named risk is the whole
// of this file: an edit that generated a new `client_local_id` would add a
// second set on the server instead of correcting the first. Everything here
// is a way that could still happen, or a way the correction could be
// silently undone after it looked like it worked.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  asUuid: (value: string) => value,
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
  mockTrackEvent.mockClear();
});

const STARTED = new Date('2026-08-15T09:00:00.000Z');
/** The original confirming tap. The correction must not move it. */
const TAP = new Date('2026-08-15T09:14:22.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const LOCAL_KEY = '018f4b1e-0000-7000-8000-0000000000aa';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';

/** See `useLogSet.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

async function seedInProgress(startOutboxId: string | null = null): Promise<void> {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    serverId: SERVER_ID,
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: 'Push A',
    status: 'in_progress',
    startedAt: STARTED.getTime(),
    completedAt: null,
    payloadJson: '{}',
    startOutboxId,
    syncState: 'pending',
    updatedAt: STARTED.getTime(),
  });
}

const ONE_SET = {
  sessionLocalId: LOCAL_KEY,
  exerciseId: EXERCISE_ID,
  setNumber: 2,
  reps: 10,
  weightKg: 80,
} as const;

/** A set already logged, exactly as `useLogSet` would have left it. */
async function logOriginal(): Promise<{ localId: string; outboxId: string }> {
  await seedInProgress();
  const logged = await logSet({ ...ONE_SET, now: () => TAP });
  mockTrackEvent.mockClear();
  return { localId: logged.localId, outboxId: logged.outboxId };
}

async function readRows() {
  const db = await getLocalDb();
  const sets = await db.select().from(localSetLogs);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sets, entries };
}

function payloadOf(entry: QueuedMutation | undefined): Record<string, unknown> {
  return deserializeOutboxPayload(entry?.payload_json ?? '') as Record<string, unknown>;
}

describe('the local row', () => {
  it('updates the existing row in place rather than writing a second one', async () => {
    const original = await logOriginal();

    await updateSet({ setLocalId: original.localId, reps: 12, weightKg: 82.5 });

    const { sets } = await readRows();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.clientLocalId).toBe(original.localId);
    expect(sets[0]?.reps).toBe(12);
    expect(sets[0]?.weightKg).toBe(82.5);
  });

  it('keeps the original tap instant, because an edit corrects a value and not a time', async () => {
    // `set_logs_client_exercise` sorts on `logged_at` to answer "last time
    // you did this exercise", and the training day a set belongs to is the
    // local calendar day of that instant (`CLAUDE.md` §25.5). Re-stamping it
    // at the correction would move the set, and possibly its day.
    const original = await logOriginal();

    const updated = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets } = await readRows();
    expect(sets[0]?.loggedAt).toBe(TAP.getTime());
    expect(updated.loggedAt).toEqual(TAP);
  });

  it('leaves the row pending again, so the next prefetch cannot overwrite the correction', async () => {
    const original = await logOriginal();
    const db = await getLocalDb();
    await db
      .update(localSetLogs)
      .set({ syncState: 'synced' })
      .where(eq(localSetLogs.clientLocalId, original.localId));

    await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets } = await readRows();
    expect(sets[0]?.syncState).toBe('pending');
  });

  it('clears a weight to null rather than storing a zero', async () => {
    const original = await logOriginal();

    await updateSet({ setLocalId: original.localId, weightKg: null });

    const { sets } = await readRows();
    expect(sets[0]?.weightKg).toBeNull();
    expect(sets[0]?.reps).toBe(10);
  });

  it('leaves an omitted field at its stored value', async () => {
    const original = await logOriginal();

    await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets } = await readRows();
    expect(sets[0]?.weightKg).toBe(80);
    expect(sets[0]?.isWarmup).toBe(false);
  });

  it('never lets the caller re-point the set at another exercise, set number, or session', async () => {
    const original = await logOriginal();

    await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets } = await readRows();
    expect(sets[0]?.exerciseId).toBe(EXERCISE_ID);
    expect(sets[0]?.setNumber).toBe(2);
    expect(sets[0]?.sessionLocalId).toBe(LOCAL_KEY);
  });
});

describe('the queued mutation', () => {
  it('re-sends workouts.logSet under the ORIGINAL key, which is what makes it an update', async () => {
    // The task's named risk. A fresh key here is a duplicate server row.
    const original = await logOriginal();

    const updated = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { entries } = await readRows();
    const correction = entries.find((entry) => entry.id === updated.outboxId);
    expect(correction?.procedure).toBe(UPDATE_SET_PROCEDURE);
    expect(correction?.client_local_id).toBe(original.localId);
    expect(updated.localId).toBe(original.localId);
  });

  it('queues a second outbox row and leaves the original mutation untouched', async () => {
    const original = await logOriginal();

    const updated = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { entries } = await readRows();
    const keyed = entries.filter((entry) => entry.client_local_id === original.localId);
    expect(keyed).toHaveLength(2);
    expect(updated.outboxId).not.toBe(original.outboxId);
    expect(payloadOf(entries.find((entry) => entry.id === original.outboxId))).toMatchObject({
      reps: 10,
    });
  });

  it('orders the correction behind the original, so the pre-edit values cannot land last', async () => {
    const original = await logOriginal();

    const updated = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { entries } = await readRows();
    expect(entries.find((entry) => entry.id === updated.outboxId)?.depends_on).toBe(
      original.outboxId,
    );
  });

  it('carries the whole set, with the original instant as a real Date', async () => {
    const original = await logOriginal();

    const updated = await updateSet({
      setLocalId: original.localId,
      reps: 12,
      weightKg: 82.5,
      isWarmup: true,
      isFailure: true,
    });

    const payload = payloadOf((await readRows()).entries.find((e) => e.id === updated.outboxId));

    expect(payload).toMatchObject({
      sessionClientLocalId: LOCAL_KEY,
      exerciseId: EXERCISE_ID,
      setNumber: 2,
      reps: 12,
      weightKg: 82.5,
      isWarmup: true,
      isFailure: true,
    });
    expect(payload.loggedAt).toEqual(TAP);
    // The flush loop merges the outbox row's own key; a second copy in the
    // payload could disagree with it.
    expect(payload).not.toHaveProperty('clientLocalId');
  });

  it('keeps a stored is_failure when the caller corrects only the reps', async () => {
    // It defaulted to `false` while `local_set_logs` had no column to read
    // back (`set-entry/04` added it), which silently cleared the flag on any
    // correction that did not restate it — and `set_logs` is device-wins, so
    // that cleared it on the server too.
    await seedInProgress();
    const original = await logSet({ ...ONE_SET, isFailure: true, now: () => TAP });

    const updated = await updateSet({ setLocalId: original.localId, reps: 9 });

    const { sets } = await readRows();
    expect(sets[0]?.isFailure).toBe(true);
    expect(
      payloadOf((await readRows()).entries.find((e) => e.id === updated.outboxId)),
    ).toMatchObject({ reps: 9, isFailure: true });
  });

  it('still clears the flag when the caller explicitly turns it off', async () => {
    await seedInProgress();
    const original = await logSet({ ...ONE_SET, isFailure: true, now: () => TAP });

    await updateSet({ setLocalId: original.localId, isFailure: false });

    const { sets } = await readRows();
    expect(sets[0]?.isFailure).toBe(false);
  });

  it('sends a cleared weight explicitly as null, so the server overwrites the old one', async () => {
    const original = await logOriginal();

    const updated = await updateSet({ setLocalId: original.localId, weightKg: null });

    const payload = payloadOf((await readRows()).entries.find((e) => e.id === updated.outboxId));
    expect(payload).toHaveProperty('weightKg', null);
  });

  it('chains a second correction behind the first', async () => {
    const original = await logOriginal();

    const first = await updateSet({ setLocalId: original.localId, reps: 11 });
    const second = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.reps).toBe(12);
    expect(entries.find((entry) => entry.id === second.outboxId)?.depends_on).toBe(first.outboxId);
  });

  it("chains to the session's start when the original mutation is no longer queued", async () => {
    // The ordinary case for a set logged in an earlier app session: its
    // outbox row is long since gone, and the set exists only in the mirror.
    const { outboxId: startOutboxId } = await enqueueMutation({
      procedure: 'workouts.start',
      payload: { workoutSessionId: SERVER_ID },
    });
    await seedInProgress(startOutboxId);
    const db = await getLocalDb();
    await db.insert(localSetLogs).values({
      id: LOCAL_KEY.replace('aa', 'ef'),
      clientLocalId: LOCAL_KEY.replace('aa', 'ef'),
      sessionLocalId: LOCAL_KEY,
      exerciseId: EXERCISE_ID,
      setNumber: 2,
      reps: 10,
      weightKg: 80,
      isWarmup: false,
      loggedAt: TAP.getTime(),
      syncState: 'synced',
    });

    const updated = await updateSet({ setLocalId: LOCAL_KEY.replace('aa', 'ef'), reps: 12 });

    const { entries } = await readRows();
    expect(entries.find((entry) => entry.id === updated.outboxId)?.depends_on).toBe(startOutboxId);
  });
});

describe('offline and online are the same path', () => {
  it('writes and queues identically with no connectivity', async () => {
    const first = await logOriginal();
    const offline = await updateSet({
      setLocalId: first.localId,
      reps: 12,
      weightKg: 82.5,
      isConnected: false,
    });
    const offlineRows = await readRows();

    sqlite.__reset();
    resetLocalDbForTests();
    resetOutboxFlushStateForTests();

    const second = await logOriginal();
    const online = await updateSet({
      setLocalId: second.localId,
      reps: 12,
      weightKg: 82.5,
      isConnected: true,
    });
    const onlineRows = await readRows();

    expect(offlineRows.sets[0]?.reps).toBe(onlineRows.sets[0]?.reps);
    expect(offlineRows.sets[0]?.weightKg).toBe(onlineRows.sets[0]?.weightKg);
    expect(offlineRows.sets[0]?.loggedAt).toBe(onlineRows.sets[0]?.loggedAt);
    expect(offlineRows.sets[0]?.syncState).toBe(onlineRows.sets[0]?.syncState);

    const offlineCorrection = offlineRows.entries.find((e) => e.id === offline.outboxId);
    const onlineCorrection = onlineRows.entries.find((e) => e.id === online.outboxId);
    expect(offlineCorrection?.procedure).toBe(onlineCorrection?.procedure);
    // Byte for byte: nothing in the payload records what the radio was doing.
    expect(offlineCorrection?.payload_json).toBe(onlineCorrection?.payload_json);
  });
});

describe('the states a set cannot be edited from', () => {
  it('refuses a set the device does not hold, and queues nothing', async () => {
    await seedInProgress();

    await expect(updateSet({ setLocalId: LOCAL_KEY, reps: 12 })).rejects.toThrow(
      /no local_set_logs row/,
    );

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('edits a set belonging to a completed session, which the server accepts and re-totals', async () => {
    const original = await logOriginal();
    const db = await getLocalDb();
    await db
      .update(localWorkoutSessions)
      .set({ status: 'completed' })
      .where(eq(localWorkoutSessions.clientLocalId, LOCAL_KEY));

    const updated = await updateSet({ setLocalId: original.localId, reps: 12 });

    const { sets } = await readRows();
    expect(sets[0]?.reps).toBe(12);
    expect(updated.localId).toBe(original.localId);
  });
});

describe('analytics', () => {
  it('fires nothing — an edit is a correction, not a second logged set', async () => {
    // Re-firing `set_logged` would inflate the denominator of every
    // per-set metric and corrupt `entry_ms`, which exists to prove §19's
    // budget for the two-tap log (`analytics-events` §5, §7).
    const original = await logOriginal();

    await updateSet({ setLocalId: original.localId, reps: 12, weightKg: 82.5 });

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});
