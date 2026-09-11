import { eq } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { resetRestTimerForTests, useRestTimerStore } from '../../store/rest-timer-store.ts';
import {
  ensureRestTimerPersistence,
  parseRestAnchor,
  REST_TIMER_META_KEY,
  resetRestTimerPersistenceForTests,
  restoreRestTimer,
} from '../rest-timer-persistence.ts';

// `phase-09-workout-logger/rest-timer/02`. The rest a client cannot see:
// they locked the phone, or the OS killed the process, and what they read
// when they come back has to be the truth rather than wherever a JS
// interval happened to stop.
//
// Five things have to be true, and four of them are ways a client reads a
// rest they are not actually taking: the anchor is on disk before the
// process can die, a rest that ran out while it was dead comes back
// finished rather than restarted, a rest whose session has since ended
// cannot come back at all, a corrupted row is ignored rather than trusted,
// and the stored row exists only while a rest is genuinely running.

// `expo-sqlite` has no Jest-side native module, so the local database runs
// against the fake `lib/outbox` maintains — same mock, same reason, as
// `session-recovery.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

const NOW_MS = new Date('2026-09-11T18:00:00.000Z').getTime();

const timer = () => useRestTimerStore.getState();

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetRestTimerPersistenceForTests();
});

afterEach(() => {
  resetRestTimerForTests();
  jest.restoreAllMocks();
});

async function seedSession(clientLocalId: string, status = 'in_progress') {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: clientLocalId,
    clientLocalId,
    serverId: null,
    scheduledDate: '2026-09-11',
    programDayId: null,
    name: null,
    status,
    startedAt: NOW_MS - 20 * 60 * 1_000,
    completedAt: null,
    payloadJson: '{}',
    startOutboxId: null,
    syncState: 'pending',
    updatedAt: NOW_MS,
  });
}

async function seedAnchor(value: string) {
  const db = await getLocalDb();
  await db
    .insert(meta)
    .values({ key: REST_TIMER_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function readAnchorRow(): Promise<string | null | undefined> {
  const db = await getLocalDb();
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, REST_TIMER_META_KEY))
    .limit(1);
  return row?.value;
}

describe('parseRestAnchor', () => {
  it('reads back what the app wrote', () => {
    const stored = JSON.stringify({
      sessionLocalId: 'local-7',
      startedAtMs: NOW_MS,
      targetSeconds: 90,
    });

    expect(parseRestAnchor(stored)).toEqual({
      sessionLocalId: 'local-7',
      startedAtMs: NOW_MS,
      targetSeconds: 90,
    });
  });

  it('rejects a row that is not JSON at all', () => {
    expect(parseRestAnchor('not json')).toBeNull();
  });

  it('rejects a row missing a field, rather than rebuilding a rest around a hole', () => {
    expect(
      parseRestAnchor(JSON.stringify({ sessionLocalId: 'local-7', targetSeconds: 90 })),
    ).toBeNull();
  });

  it('rejects a field of the wrong type', () => {
    const stored = JSON.stringify({
      sessionLocalId: 'local-7',
      startedAtMs: '2026-09-11',
      targetSeconds: 90,
    });

    expect(parseRestAnchor(stored)).toBeNull();
  });

  it('rejects a non-finite number, which would put a NaN countdown on screen', () => {
    // `JSON.stringify` writes NaN as `null`; a hand-edited or older-build
    // row could still carry one through.
    expect(
      parseRestAnchor('{"sessionLocalId":"local-7","startedAtMs":null,"targetSeconds":90}'),
    ).toBeNull();
  });

  it('rejects an absent row', () => {
    expect(parseRestAnchor(null)).toBeNull();
    expect(parseRestAnchor(undefined)).toBeNull();
  });
});

describe('restoreRestTimer', () => {
  it('finds nothing on the ordinary launch, where no rest was in flight', async () => {
    await seedSession('local-7');

    expect(await restoreRestTimer({ nowMs: NOW_MS })).toEqual({ kind: 'none' });
    expect(timer().isRunning).toBe(false);
  });

  it('puts a rest that was still running back on the clock it actually kept', async () => {
    await seedSession('local-7');
    await seedAnchor(
      JSON.stringify({
        sessionLocalId: 'local-7',
        startedAtMs: NOW_MS - 30_000,
        targetSeconds: 90,
      }),
    );

    const restoration = await restoreRestTimer({ nowMs: NOW_MS });

    expect(restoration).toEqual({
      kind: 'resumed',
      sessionLocalId: 'local-7',
      remainingSeconds: 60,
    });
    expect(timer()).toMatchObject({ isRunning: true, remainingSeconds: 60, targetSeconds: 90 });
  });

  it('resolves a rest that ran out while the process was dead to finished, not restarted', async () => {
    await seedSession('local-7');
    await seedAnchor(
      JSON.stringify({
        sessionLocalId: 'local-7',
        startedAtMs: NOW_MS - 5 * 60 * 1_000,
        targetSeconds: 90,
      }),
    );

    const restoration = await restoreRestTimer({ nowMs: NOW_MS });

    expect(restoration).toEqual({
      kind: 'expired',
      sessionLocalId: 'local-7',
      targetSeconds: 90,
      // The moment it actually ended, not the moment we noticed — the alert
      // at zero has to be able to tell how long ago that was.
      endedAtMs: NOW_MS - 5 * 60 * 1_000 + 90_000,
    });
    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0, targetSeconds: 90 });
  });

  it('clears the stored row once the expired rest has been reported, so it is reported once', async () => {
    await seedSession('local-7');
    await seedAnchor(
      JSON.stringify({
        sessionLocalId: 'local-7',
        startedAtMs: NOW_MS - 5 * 60 * 1_000,
        targetSeconds: 90,
      }),
    );

    await restoreRestTimer({ nowMs: NOW_MS });

    expect(await readAnchorRow()).toBeUndefined();
  });

  it('refuses a rest whose session has since been completed', async () => {
    // The correctness gap persistence creates: a rest outliving the workout
    // it belonged to would start counting again on the next launch.
    await seedSession('local-7', 'completed');
    await seedAnchor(
      JSON.stringify({
        sessionLocalId: 'local-7',
        startedAtMs: NOW_MS - 30_000,
        targetSeconds: 90,
      }),
    );

    expect(await restoreRestTimer({ nowMs: NOW_MS })).toEqual({ kind: 'none' });
    expect(timer().isRunning).toBe(false);
    expect(await readAnchorRow()).toBeUndefined();
  });

  it('refuses a rest whose session the device no longer holds at all', async () => {
    await seedAnchor(
      JSON.stringify({ sessionLocalId: 'gone', startedAtMs: NOW_MS - 30_000, targetSeconds: 90 }),
    );

    expect(await restoreRestTimer({ nowMs: NOW_MS })).toEqual({ kind: 'none' });
    expect(await readAnchorRow()).toBeUndefined();
  });

  it('discards a corrupted row rather than trusting it', async () => {
    await seedSession('local-7');
    await seedAnchor('{"sessionLocalId":"local-7"}');

    expect(await restoreRestTimer({ nowMs: NOW_MS })).toEqual({ kind: 'none' });
    expect(timer().isRunning).toBe(false);
    expect(await readAnchorRow()).toBeUndefined();
  });
});

describe('ensureRestTimerPersistence', () => {
  it('writes the anchor the moment a set starts a rest, before anything can kill the process', async () => {
    await seedSession('local-7');
    await ensureRestTimerPersistence({ nowMs: NOW_MS });

    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: NOW_MS });
    await flush();

    expect(parseRestAnchor(await readAnchorRow())).toEqual({
      sessionLocalId: 'local-7',
      startedAtMs: NOW_MS,
      targetSeconds: 90,
    });
  });

  it('survives an app kill mid-rest — the whole point of the task', async () => {
    await seedSession('local-7');
    await ensureRestTimerPersistence({ nowMs: NOW_MS });
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: NOW_MS });
    await flush();

    // The process dies and comes back thirty seconds later. Only the
    // database survives.
    resetRestTimerForTests();
    resetRestTimerPersistenceForTests();
    const restoration = await ensureRestTimerPersistence({ nowMs: NOW_MS + 30_000 });

    expect(restoration).toMatchObject({ kind: 'resumed', remainingSeconds: 60 });
    expect(timer()).toMatchObject({ isRunning: true, remainingSeconds: 60 });
  });

  it('removes the anchor when the rest reaches zero, so a finished rest is never restored', async () => {
    await seedSession('local-7');
    await ensureRestTimerPersistence({ nowMs: NOW_MS });
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: NOW_MS });
    await flush();

    timer().tick(NOW_MS + 90_000);
    await flush();

    expect(await readAnchorRow()).toBeUndefined();
  });

  it('removes the anchor when the session that started the rest is finished', async () => {
    await seedSession('local-7');
    await ensureRestTimerPersistence({ nowMs: NOW_MS });
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: NOW_MS });
    await flush();

    timer().stopRestForSession('local-7');
    await flush();

    expect(await readAnchorRow()).toBeUndefined();
  });

  it('stores nothing for a rest nobody named a session for', async () => {
    await ensureRestTimerPersistence({ nowMs: NOW_MS });

    timer().startRest(90, { nowMs: NOW_MS });
    await flush();

    expect(await readAnchorRow()).toBeUndefined();
  });

  it('subscribes once however many times it is called', async () => {
    await seedSession('local-7');
    const subscribe = jest.spyOn(useRestTimerStore, 'subscribe');

    await ensureRestTimerPersistence({ nowMs: NOW_MS });
    await ensureRestTimerPersistence({ nowMs: NOW_MS });
    await ensureRestTimerPersistence({ nowMs: NOW_MS });

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('reports a local-read failure and leaves the logger running', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    resetLocalDbForTests();
    const sqliteModule = jest.requireMock('expo-sqlite') as {
      openDatabaseAsync: (name: string) => Promise<unknown>;
    };
    jest.spyOn(sqliteModule, 'openDatabaseAsync').mockRejectedValue(new Error('disk I/O error'));

    expect(await ensureRestTimerPersistence({ nowMs: NOW_MS })).toEqual({ kind: 'none' });
    expect(console.warn).toHaveBeenCalledWith(
      'workouts.rest_timer_restore_failed',
      expect.objectContaining({ errorName: 'Error' }),
    );
  });
});

/** Drains the fire-and-forget write chain the subscription queues. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
