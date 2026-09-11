import type {
  UpcomingSession,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localSetLogs, localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { resetRestTimerForTests, useRestTimerStore } from '../../store/rest-timer-store.ts';
import { COMPLETE_PROCEDURE, completeSession } from '../useCompleteSession.ts';

// `phase-09-workout-logger/session-runtime/07`. Five things have to be true,
// and four of them are ways a client loses the session they just finished:
// the local row flips before anything touches the wire, the mutation is
// queued behind the session's own start, the session is named by the key
// that exists even when no server id does, a second tap queues nothing, and
// the analytics that follow can fail without taking the completion with them.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

// `mock`-prefixed because jest hoists the factory above every other
// declaration in this file and refuses an out-of-scope reference otherwise.
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
/** 72 minutes 30 seconds after the start. */
const TAP = new Date('2026-08-15T10:12:30.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const LOCAL_KEY = '018f4b1e-0000-7000-8000-0000000000aa';
const EXERCISE_ID = '018f4b1e-0000-7000-8000-0000000000cc';

/** See `useStartAdHocSession.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

function block(targetSets: number, orderIndex: number): UpcomingSessionExercise {
  return {
    programExerciseId: `pe-${orderIndex}`,
    exerciseId: EXERCISE_ID,
    orderIndex,
    targetSets,
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetRir: null,
    targetRestSeconds: 90,
    tempo: null,
    supersetGroup: null,
    alternatives: [],
    coachNotes: null,
    targetRpe: 8,
    targetWeightKg: null,
    targetPercent1rm: null,
  } as UpcomingSessionExercise;
}

function upcomingSession(exercises: UpcomingSessionExercise[]): UpcomingSession {
  return {
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    assignmentId: '018f4b1e-0000-7000-8000-0000000000bb',
    programDayId: 'day-1',
    name: 'Push A',
    scheduledDate: '2026-08-15',
    status: 'in_progress',
    startedAt: STARTED,
    completedAt: null,
    updatedAt: STARTED,
    dayName: 'Push A',
    dayNotes: null,
    exercises,
  } as UpcomingSession;
}

/** A session already under way, as `useStartSession` would have left it. */
async function seedInProgress(
  overrides: Partial<typeof localWorkoutSessions.$inferInsert> = {},
  exercises: UpcomingSessionExercise[] = [block(3, 0), block(3, 1)],
) {
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
    payloadJson: serialiseSessionPayload({
      session: upcomingSession(exercises),
      exercises: [],
    }),
    startOutboxId: null,
    syncState: 'pending',
    updatedAt: STARTED.getTime(),
    ...overrides,
  });
}

async function seedSets(sets: readonly { isWarmup?: boolean }[]) {
  const db = await getLocalDb();
  let n = 0;
  for (const set of sets) {
    n += 1;
    await db.insert(localSetLogs).values({
      id: `set-${n}`,
      clientLocalId: `set-key-${n}`,
      sessionLocalId: LOCAL_KEY,
      exerciseId: EXERCISE_ID,
      setNumber: n,
      reps: 10,
      weightKg: 60,
      isWarmup: set.isWarmup ?? false,
      loggedAt: STARTED.getTime(),
    });
  }
}

async function readRows() {
  const db = await getLocalDb();
  const sessions = await db.select().from(localWorkoutSessions);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sessions, entries };
}

describe('the local transition', () => {
  it('flips the row to completed with the tap instant as completed_at', async () => {
    await seedInProgress();

    const completed = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions } = await readRows();
    expect(sessions[0]?.status).toBe('completed');
    expect(sessions[0]?.completedAt).toBe(TAP.getTime());
    expect(completed.completedAt).toEqual(TAP);
    expect(completed.localId).toBe(LOCAL_KEY);
  });

  it('leaves the row pending, so the next prefetch cannot revert it', async () => {
    await seedInProgress();

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions } = await readRows();
    expect(sessions[0]?.syncState).toBe('pending');
    expect(sessions[0]?.updatedAt).toBe(TAP.getTime());
  });

  it('persists the completion outbox id on the row, not only in the return value', async () => {
    // `session-summary/03`'s notes update chains to this entry, and it runs
    // one navigation later on a screen that never saw the return value —
    // and, after a force-quit, in a process that never saw it either. Held
    // in memory it is simply gone by the time it is needed, which is
    // `start_outbox_id`'s own reason for existing.
    await seedInProgress();

    const completed = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions, entries } = await readRows();
    expect(completed.outboxId).not.toBeNull();
    expect(sessions[0]?.completeOutboxId).toBe(completed.outboxId);
    expect(entries.map((entry) => entry.id)).toContain(completed.outboxId);
  });

  it('leaves complete_outbox_id alone on a repeat completion', async () => {
    // Rule (f): the second tap queues nothing, so there is no new id — and
    // overwriting the stored one with null would strand a notes update that
    // had nothing left to chain to.
    await seedInProgress();
    const first = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const second = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions } = await readRows();
    expect(second.outboxId).toBeNull();
    expect(sessions[0]?.completeOutboxId).toBe(first.outboxId);
  });

  it('does not need the network — nothing is sent, only queued', async () => {
    await seedInProgress();

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.procedure).toBe(COMPLETE_PROCEDURE);
  });
});

describe('the queued mutation', () => {
  it('names the session by its client_local_id and carries the tap instant', async () => {
    await seedInProgress();

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as {
      sessionClientLocalId: string;
      completedAt: Date;
    };
    expect(payload.sessionClientLocalId).toBe(LOCAL_KEY);
    // superjson, not JSON — `offline-sync` §10's "timestamped at reconnect".
    expect(payload.completedAt).toBeInstanceOf(Date);
    expect(payload.completedAt.getTime()).toBe(TAP.getTime());
  });

  it('completes a session the server has never confirmed — no server id needed', async () => {
    // An ad-hoc session started offline: `useStartAdHocSession` writes
    // `serverId: null` and the flush loop never writes one back. A completion
    // keyed on a server id could not name this row at all.
    await seedInProgress({ serverId: null, id: LOCAL_KEY });

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries, sessions } = await readRows();
    expect(sessions[0]?.status).toBe('completed');
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as {
      sessionClientLocalId: string;
    };
    expect(payload.sessionClientLocalId).toBe(LOCAL_KEY);
  });

  it('carries the outbox’s own key, which is not the session’s', async () => {
    await seedInProgress();

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    // `flush.ts` merges the outbox row's `clientLocalId` into the payload, so
    // the mutation's key must not be the session's — two ids, two jobs.
    expect(entries[0]?.client_local_id).not.toBe(LOCAL_KEY);
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('clientLocalId');
  });

  it('chains to the session’s start, so it can never arrive before it', async () => {
    // DB§14.2. A completion the server sees before the start would find a
    // `scheduled` row and be dropped on the floor.
    const { outboxId } = await enqueueMutation({
      procedure: 'workouts.start',
      payload: { workoutSessionId: SERVER_ID },
    });
    await seedInProgress({ startOutboxId: outboxId });

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    const completion = entries.find((entry) => entry.procedure === COMPLETE_PROCEDURE);
    expect(completion?.depends_on).toBe(outboxId);
  });

  it('queues unchained when the row carries no start outbox id', async () => {
    // A row an older build started. `enqueueMutation` throws on a
    // `dependsOn` that names nothing, so inventing a parent would strand the
    // completion rather than order it (`useStartSession`'s own note).
    await seedInProgress({ startOutboxId: null });

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    expect(entries[0]?.depends_on).toBeNull();
  });
});

describe('a second tap', () => {
  it('queues nothing and returns the completion already stored', async () => {
    await seedInProgress();
    const first = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const later = new Date(TAP.getTime() + 60_000);
    const second = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => later });

    expect(second.completedAt).toEqual(first.completedAt);
    expect(second.outboxId).toBeNull();
    const { entries, sessions } = await readRows();
    expect(entries).toHaveLength(1);
    expect(sessions[0]?.completedAt).toBe(TAP.getTime());
  });

  it('emits the analytics event exactly once', async () => {
    await seedInProgress();

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });
    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });
});

describe('the states it refuses', () => {
  it('throws for a session the device does not hold', async () => {
    await expect(completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP })).rejects.toThrow();
  });

  it('throws rather than completing a session that was never started', async () => {
    // The `session_completion` CHECK needs a `started_at`, and there is none.
    await seedInProgress({ status: 'scheduled', startedAt: null });

    await expect(completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP })).rejects.toThrow();
    const { entries } = await readRows();
    expect(entries).toHaveLength(0);
  });
});

describe('analytics', () => {
  it('reports the session by its device key, with counts and no free text', async () => {
    await seedInProgress({}, [block(3, 0), block(3, 1)]); // 6 target sets
    await seedSets([{}, {}, {}, { isWarmup: true }]); // 3 working sets logged

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP, isConnected: false });

    expect(mockTrackEvent).toHaveBeenCalledWith('workout_completed', {
      session_id: LOCAL_KEY,
      set_count: 3,
      duration_s: 4_350,
      completion_pct: 50,
      was_offline: true,
    });
  });

  it('reports 0% for a session with nothing prescribed rather than dividing by zero', async () => {
    await seedInProgress({}, []);

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'workout_completed',
      expect.objectContaining({ completion_pct: 0, set_count: 0 }),
    );
  });

  it('never reports a negative duration when the device clock runs backwards', async () => {
    await seedInProgress();

    await completeSession({
      sessionLocalId: LOCAL_KEY,
      now: () => new Date(STARTED.getTime() - 60_000),
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'workout_completed',
      expect.objectContaining({ duration_s: 0 }),
    );
  });

  it('still completes the session when the payload will not parse', async () => {
    // By the time the event is emitted the session has already been written.
    // A throw here would report a finished session as a failure to a client
    // standing in a gym (`ERRORS.md` ER§3).
    await seedInProgress({ payloadJson: 'not superjson at all' });

    const completed = await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions, entries } = await readRows();
    expect(completed.outboxId).not.toBeNull();
    expect(sessions[0]?.status).toBe('completed');
    expect(entries).toHaveLength(1);
  });
});

describe('the rest timer', () => {
  afterEach(() => {
    resetRestTimerForTests();
  });

  it('ends the rest the last set started — rule (g)', async () => {
    // The rest is durable from `rest-timer/02` on, so one left running
    // would be restored for a workout the client has already finished.
    await seedInProgress();
    useRestTimerStore.getState().startRest(90, { sessionLocalId: LOCAL_KEY, nowMs: 0 });

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    expect(useRestTimerStore.getState()).toMatchObject({
      isRunning: false,
      sessionLocalId: null,
    });
  });

  it("leaves another session's rest running", async () => {
    await seedInProgress();
    useRestTimerStore.getState().startRest(90, { sessionLocalId: 'another-session', nowMs: 0 });

    await completeSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    expect(useRestTimerStore.getState()).toMatchObject({
      isRunning: true,
      sessionLocalId: 'another-session',
    });
  });
});
