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
import {
  DEFAULT_REST_SECONDS,
  resetRestTimerForTests,
  useRestTimerStore,
} from '../../store/rest-timer-store.ts';
import { LOG_SET_PROCEDURE, logSet } from '../useLogSet.ts';

// `phase-09-workout-logger/set-entry/01`. Five things have to be true, and
// four of them are ways a client's logged set is lost, duplicated, or
// misdated: the local row and the queued mutation share ONE key, the set
// chains behind the session's start, the tap instant is what gets stored,
// nothing in the path touches the network, and the analytics that follow can
// fail without taking the set with them.

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

// A logged set arms a real interval (`store/rest-timer-store.ts`), which
// would otherwise outlive the file that started it.
afterEach(() => {
  resetRestTimerForTests();
});

const STARTED = new Date('2026-08-15T09:00:00.000Z');
/** The confirming tap. Hours before any plausible reconnect. */
const TAP = new Date('2026-08-15T09:14:22.000Z');
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
): Promise<void> {
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
      session: upcomingSession([block(3, 0)]),
      exercises: [],
    }),
    startOutboxId: null,
    syncState: 'pending',
    updatedAt: STARTED.getTime(),
    ...overrides,
  });
}

/** The session's own start mutation, so a set has a real parent to chain to. */
async function seedStartedWithChain(): Promise<string> {
  const { outboxId } = await enqueueMutation({
    procedure: 'workouts.start',
    payload: { workoutSessionId: SERVER_ID, startedAt: STARTED },
  });
  await seedInProgress({ startOutboxId: outboxId });
  return outboxId;
}

async function readRows() {
  const db = await getLocalDb();
  const sets = await db.select().from(localSetLogs);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sets, entries };
}

const ONE_SET = {
  sessionLocalId: LOCAL_KEY,
  exerciseId: EXERCISE_ID,
  setNumber: 1,
  reps: 10,
  weightKg: 80,
} as const;

describe('the local write', () => {
  it('writes the set to local_set_logs with the tap instant', async () => {
    await seedInProgress();

    const logged = await logSet({ ...ONE_SET, now: () => TAP });

    const { sets } = await readRows();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.sessionLocalId).toBe(LOCAL_KEY);
    expect(sets[0]?.exerciseId).toBe(EXERCISE_ID);
    expect(sets[0]?.setNumber).toBe(1);
    expect(sets[0]?.reps).toBe(10);
    expect(sets[0]?.weightKg).toBe(80);
    // Not the flush instant — `offline-sync` §10, and the index that answers
    // "last time you did this exercise" sorts on exactly this column.
    expect(sets[0]?.loggedAt).toBe(TAP.getTime());
    expect(logged.loggedAt).toEqual(TAP);
  });

  it('leaves the row pending, so the next prefetch cannot overwrite it', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, now: () => TAP });

    const { sets } = await readRows();
    expect(sets[0]?.syncState).toBe('pending');
  });

  it('stores a bodyweight set with a null weight rather than a zero', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, weightKg: null, now: () => TAP });

    const { sets } = await readRows();
    expect(sets[0]?.weightKg).toBeNull();
  });

  it('mirrors both flags, not just the one the server sees', async () => {
    // `set-entry/04`. `is_failure` reached the outbox payload and stopped
    // there while this mirror had no column for it, so a client who logged a
    // set to failure and force-quit reloaded the session with the flag gone.
    await seedInProgress();

    await logSet({ ...ONE_SET, isWarmup: true, isFailure: true, now: () => TAP });

    const { sets } = await readRows();
    expect(sets[0]?.isWarmup).toBe(true);
    expect(sets[0]?.isFailure).toBe(true);
  });

  it('defaults both flags to false, so the common case stays a plain working set', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, now: () => TAP });

    const { sets } = await readRows();
    expect(sets[0]?.isWarmup).toBe(false);
    expect(sets[0]?.isFailure).toBe(false);
  });
});

describe('the queued mutation', () => {
  it('queues workouts.logSet with the SAME key as the local row', async () => {
    await seedInProgress();

    const logged = await logSet({ ...ONE_SET, now: () => TAP });

    const { sets, entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.procedure).toBe(LOG_SET_PROCEDURE);
    // One identity, two tables. A second key here is `offline-sync` §3's
    // "one set becomes one set per retry".
    expect(entries[0]?.client_local_id).toBe(sets[0]?.clientLocalId);
    expect(logged.localId).toBe(sets[0]?.clientLocalId);
    expect(logged.outboxId).toBe(entries[0]?.id);
  });

  it('carries the session key, the numbers, and the tap instant as a real Date', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, isWarmup: true, isFailure: true, now: () => TAP });

    const { entries } = await readRows();
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as Record<
      string,
      unknown
    >;

    expect(payload).toMatchObject({
      sessionClientLocalId: LOCAL_KEY,
      exerciseId: EXERCISE_ID,
      setNumber: 1,
      reps: 10,
      weightKg: 80,
      isWarmup: true,
      isFailure: true,
    });
    // superjson, not JSON — a `Date` that degraded to a string across an app
    // restart is the "timestamped at reconnect" failure wearing a hat.
    expect(payload.loggedAt).toEqual(TAP);
    // The flush loop merges the outbox row's own key; the payload must not
    // carry a second copy that could disagree with it.
    expect(payload).not.toHaveProperty('clientLocalId');
  });

  it('sends weightKg explicitly as null, so a re-send can clear a stored weight', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, weightKg: null, now: () => TAP });

    const { entries } = await readRows();
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as Record<
      string,
      unknown
    >;
    // `set_logs` is device-wins (DB§14.3) and the server overwrites only the
    // columns the payload names. An omitted key would leave the old weight.
    expect(payload).toHaveProperty('weightKg', null);
  });

  it("chains the set behind the session's start, never behind the previous set", async () => {
    const startOutboxId = await seedStartedWithChain();

    const first = await logSet({ ...ONE_SET, now: () => TAP });
    const second = await logSet({ ...ONE_SET, setNumber: 2, now: () => TAP });

    const { entries } = await readRows();
    const sets = entries.filter((entry) => entry.procedure === LOG_SET_PROCEDURE);

    expect(sets).toHaveLength(2);
    // Siblings of the start, and of each other — so forty sets flush
    // concurrently instead of serialising behind one slow request
    // (`enqueue.ts` rule 4).
    expect(sets.every((entry) => entry.depends_on === startOutboxId)).toBe(true);
    expect(sets.map((entry) => entry.id)).toEqual([first.outboxId, second.outboxId]);
  });

  it('queues unchained rather than inventing a parent when the row has no start id', async () => {
    // A session an older build started, with `start_outbox_id` null. A
    // `dependsOn` naming nothing throws in `enqueueMutation`, and a stranded
    // set is worse than an unordered one.
    await seedInProgress({ startOutboxId: null });

    await logSet({ ...ONE_SET, now: () => TAP });

    const { entries } = await readRows();
    expect(entries[0]?.depends_on).toBeNull();
  });

  it('never writes a set without queuing one — every set goes through the outbox', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, now: () => TAP });
    await logSet({ ...ONE_SET, setNumber: 2, now: () => TAP });
    await logSet({ ...ONE_SET, setNumber: 3, now: () => TAP });

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(3);
    expect(entries.filter((entry) => entry.procedure === LOG_SET_PROCEDURE)).toHaveLength(3);
    expect(new Set(sets.map((set) => set.clientLocalId)).size).toBe(3);
  });
});

describe('offline and online are the same path', () => {
  it('writes and queues identically with no connectivity', async () => {
    await seedInProgress();
    const offline = await logSet({ ...ONE_SET, isConnected: false, now: () => TAP });

    const offlineRows = await readRows();

    sqlite.__reset();
    resetLocalDbForTests();
    resetOutboxFlushStateForTests();
    await seedInProgress();
    const online = await logSet({ ...ONE_SET, isConnected: true, now: () => TAP });

    const onlineRows = await readRows();

    // Everything except the two generated ids, which are uuidv7 and
    // deliberately differ.
    expect(offlineRows.sets[0]?.loggedAt).toBe(onlineRows.sets[0]?.loggedAt);
    expect(offlineRows.sets[0]?.syncState).toBe(onlineRows.sets[0]?.syncState);
    expect(offlineRows.entries[0]?.procedure).toBe(onlineRows.entries[0]?.procedure);
    expect(offlineRows.entries[0]?.payload_json).toBe(onlineRows.entries[0]?.payload_json);
    expect(offline.setNumber).toBe(online.setNumber);
  });
});

describe('the states a set cannot be logged from', () => {
  it('refuses a session the device does not hold', async () => {
    await expect(logSet({ ...ONE_SET, now: () => TAP })).rejects.toThrow(
      /no local_workout_sessions row/,
    );

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it('refuses a session that is not in progress, and queues nothing', async () => {
    await seedInProgress({ status: 'completed', completedAt: STARTED.getTime() });

    await expect(logSet({ ...ONE_SET, now: () => TAP })).rejects.toThrow(/is not in progress/);

    const { sets, entries } = await readRows();
    expect(sets).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });
});

describe('analytics', () => {
  it('fires set_logged with ids and counts, and nothing that is a body value', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, isWarmup: true, now: () => TAP });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    const [name, properties] = mockTrackEvent.mock.calls[0] as [string, Record<string, unknown>];

    expect(name).toBe('set_logged');
    expect(properties).toMatchObject({
      session_id: LOCAL_KEY,
      exercise_id: EXERCISE_ID,
      set_number: 1,
      is_warmup: true,
      had_rpe: false,
      was_offline: false,
    });
    expect(typeof properties.entry_ms).toBe('number');

    // `CLAUDE.md` §21.1: a weight and a rep count are sensitive-class values
    // and must never reach PostHog. The typed event union has no field for
    // either; this is the by-eye check `analytics-events` §3 also asks for.
    expect(properties).not.toHaveProperty('weight_kg');
    expect(properties).not.toHaveProperty('reps');
    expect(Object.values(properties)).not.toContain(80);
  });

  it('reports was_offline when the radio is off', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, isConnected: false, now: () => TAP });

    const [, properties] = mockTrackEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties.was_offline).toBe(true);
  });

  it('does not fail the set when the event throws', async () => {
    await seedInProgress();
    mockTrackEvent.mockImplementationOnce(() => {
      throw new Error('posthog exploded');
    });

    const logged = await logSet({ ...ONE_SET, now: () => TAP });

    // The set is logged; an analytics failure is silent (`ERRORS.md` ER§3).
    expect(logged.localId).toBeTruthy();
    const { sets } = await readRows();
    expect(sets).toHaveLength(1);
  });
});

describe('the rest timer', () => {
  // `rest-timer/01`. §8.4: "Auto rest timer starts on set completion." The
  // trigger is the confirm, the duration is the coach's, and neither waits
  // on anything remote.
  it("starts on the local write, from the exercise's coach-set target", async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, targetRestSeconds: 120, now: () => TAP });

    expect(useRestTimerStore.getState()).toMatchObject({
      isRunning: true,
      targetSeconds: 120,
      remainingSeconds: 120,
    });
  });

  it('starts from the default for an exercise with no rest target', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, targetRestSeconds: null, now: () => TAP });

    expect(useRestTimerStore.getState().targetSeconds).toBe(DEFAULT_REST_SECONDS);
  });

  it('starts from the default for an ad-hoc set, which carries no prescription', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, now: () => TAP });

    expect(useRestTimerStore.getState().targetSeconds).toBe(DEFAULT_REST_SECONDS);
  });

  it('is running while the set is still queued, so the rest never waits on a flush', async () => {
    await seedInProgress();

    await logSet({ ...ONE_SET, isConnected: false, now: () => TAP });

    const { entries } = await readRows();
    // The server has not seen this set and will not for as long as the
    // radio is off — the rest is under way regardless.
    expect(entries).toHaveLength(1);
    expect(useRestTimerStore.getState().isRunning).toBe(true);
  });

  it('does not start when the write is refused', async () => {
    await seedInProgress({ status: 'scheduled' });

    await expect(logSet({ ...ONE_SET, now: () => TAP })).rejects.toThrow('not in progress');

    expect(useRestTimerStore.getState().isRunning).toBe(false);
  });
});
