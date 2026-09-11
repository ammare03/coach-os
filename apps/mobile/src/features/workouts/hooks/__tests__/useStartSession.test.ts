import { workouts as workoutsSchemas } from '@coachos/schemas';
import type { UpcomingSession } from 'api/src/features/workouts/upcoming.ts';
import { eq, sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { runFlushPass, resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { AD_HOC_PROCEDURE, startAdHocSession } from '../useStartAdHocSession.ts';
import { START_PROCEDURE, startSession } from '../useStartSession.ts';

// `phase-09-workout-logger/session-runtime/01`. Four things have to be true,
// and each is a way the client either waits on a network they do not have or
// loses the work they are about to do: the local row flips before anything
// touches the wire, the mutation is queued rather than sent, the outbox id
// survives the app process so later sets can chain to it, and a second tap
// changes nothing.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
});

const TAP = new Date('2026-08-14T19:00:00.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const LOCAL_KEY = '018f4b1e-0000-7000-8000-0000000000aa';
const ASSIGNMENT_ID = '018f4b1e-0000-7000-8000-0000000000bb';

/** See `useStartAdHocSession.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

function upcomingSession(overrides: Partial<UpcomingSession> = {}): UpcomingSession {
  return {
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    assignmentId: ASSIGNMENT_ID,
    programDayId: 'day-1',
    name: 'Push A',
    scheduledDate: '2026-08-15',
    status: 'scheduled',
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    dayName: 'Push A',
    dayNotes: null,
    exercises: [],
    ...overrides,
  } as UpcomingSession;
}

/** The row `lib/prefetch/sessions.ts` would have written for an assigned session. */
async function seedScheduled(overrides: Partial<typeof localWorkoutSessions.$inferInsert> = {}) {
  const db = await getLocalDb();
  const session = upcomingSession();
  await db.insert(localWorkoutSessions).values({
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    serverId: SERVER_ID,
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: 'Push A',
    status: 'scheduled',
    startedAt: null,
    completedAt: null,
    payloadJson: serialiseSessionPayload({ session, exercises: [] }),
    startOutboxId: null,
    syncState: 'synced',
    updatedAt: session.updatedAt.getTime(),
    ...overrides,
  });
}

async function readRows() {
  const db = await getLocalDb();
  const sessions = await db.select().from(localWorkoutSessions);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox`);
  return { sessions, entries };
}

describe('the local transition', () => {
  it('flips the row to in_progress with the tap instant as started_at', async () => {
    await seedScheduled();

    const started = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions } = await readRows();
    expect(sessions[0]?.status).toBe('in_progress');
    expect(sessions[0]?.startedAt).toBe(TAP.getTime());
    expect(started.startedAt).toEqual(TAP);
    expect(started.localId).toBe(LOCAL_KEY);
  });

  it('leaves the row pending, so the next prefetch cannot overwrite it', async () => {
    await seedScheduled();

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    // `offline-sync` §5 / `lib/prefetch/sessions.ts` rule (c).
    const { sessions } = await readRows();
    expect(sessions[0]?.syncState).toBe('pending');
    expect(sessions[0]?.updatedAt).toBe(TAP.getTime());
    // The server's own id is untouched — this is a transition, not a new row.
    expect(sessions[0]?.serverId).toBe(SERVER_ID);
  });

  it('does not need the network — nothing is sent, only queued', async () => {
    await seedScheduled();

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.procedure).toBe(START_PROCEDURE);
    expect(entries[0]?.depends_on).toBeNull();
  });
});

describe('the queued mutation', () => {
  it('names the session by its server id and carries the tap instant', async () => {
    await seedScheduled();

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { entries } = await readRows();
    const payload = deserializeOutboxPayload(entries[0]?.payload_json ?? '') as {
      workoutSessionId: string;
      startedAt: Date;
    };
    expect(payload.workoutSessionId).toBe(SERVER_ID);
    // superjson, not JSON — `offline-sync` §10's "timestamped at reconnect".
    expect(payload.startedAt).toBeInstanceOf(Date);
    expect(payload.startedAt.getTime()).toBe(TAP.getTime());
  });

  it('carries the outbox’s own key, not the session’s — the session is named by id', async () => {
    await seedScheduled();

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    // The session already exists server-side and already carries its own
    // deterministic `client_local_id` (DB§14.5). Re-keying the transition on
    // it would make the row the conflict target of an upsert that must never
    // insert — so the outbox's key stays the mutation's, and the row is
    // named by `workoutSessionId`. `flush.ts` merges the key in regardless,
    // which is why the input schema still accepts one.
    const { entries } = await readRows();
    expect(entries[0]?.client_local_id).not.toBe(LOCAL_KEY);
    expect(deserializeOutboxPayload(entries[0]?.payload_json ?? '')).not.toHaveProperty(
      'clientLocalId',
    );
  });

  it('refuses a session the server has never heard of', async () => {
    await seedScheduled({ serverId: null });

    // Nothing to transition server-side. Queuing it anyway would send a
    // `workoutSessionId` that names no row, which fails forever.
    await expect(startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP })).rejects.toThrow();
    const { entries } = await readRows();
    expect(entries).toHaveLength(0);
  });

  it('refuses a session this device does not hold', async () => {
    await expect(startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP })).rejects.toThrow();
  });
});

describe('the outbox id every later mutation chains to', () => {
  it('is persisted on the row, not held in memory', async () => {
    await seedScheduled();

    const started = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    // `lib/outbox/enqueue.ts` rule 2: a client force-quits mid-workout and
    // comes back; sets logged after the restart still need the session's
    // outbox id, and a chain broken at that seam sends sets for a session the
    // server has never heard of.
    const { sessions } = await readRows();
    expect(sessions[0]?.startOutboxId).toBe(started.outboxId);
  });

  it('is a real outbox row, so a set log can actually depend on it', async () => {
    await seedScheduled();

    const started = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });
    if (started.outboxId === null) throw new Error('expected an outbox id');

    const child = await enqueueMutation({
      procedure: 'workouts.logSet',
      payload: { setNumber: 1 },
      dependsOn: started.outboxId,
    });

    const { entries } = await readRows();
    expect(entries.find((entry) => entry.id === child.outboxId)?.depends_on).toBe(started.outboxId);
  });

  it('is recorded by an ad-hoc start too, so both paths chain the same way', async () => {
    const started = await startAdHocSession({ timeZone: 'UTC', now: () => TAP });

    const { sessions, entries } = await readRows();
    expect(sessions[0]?.startOutboxId).toBe(started.outboxId);
    expect(entries[0]?.procedure).toBe(AD_HOC_PROCEDURE);
  });
});

describe('idempotency', () => {
  it('is a no-op on a session already in progress', async () => {
    await seedScheduled();
    const first = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const later = new Date(TAP.getTime() + 60_000);
    const second = await startSession({ sessionLocalId: LOCAL_KEY, now: () => later });

    const { sessions, entries } = await readRows();
    // A duplicate tap must not queue a second start, and must not move
    // `started_at` — the client's rest timers and duration read off it.
    expect(entries).toHaveLength(1);
    expect(sessions[0]?.startedAt).toBe(TAP.getTime());
    expect(second.outboxId).toBe(first.outboxId);
    expect(second.startedAt).toEqual(TAP);
  });

  it('returns the stored outbox id so a resumed session still chains', async () => {
    // The kill-recovery seam (`session-runtime/06`): a fresh app process has
    // no memory of the start, only the row.
    await seedScheduled();
    const first = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });
    resetLocalDbForTests();

    const resumed = await startSession({ sessionLocalId: LOCAL_KEY, now: () => new Date() });

    expect(resumed.outboxId).toBe(first.outboxId);
  });

  it('leaves a completed session alone rather than restarting it', async () => {
    await seedScheduled({
      status: 'completed',
      startedAt: TAP.getTime() - 3_600_000,
      completedAt: TAP.getTime() - 600_000,
    });

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions, entries } = await readRows();
    expect(sessions[0]?.status).toBe('completed');
    expect(entries).toHaveLength(0);
  });
});

describe('the local mirror is written whatever the connection is doing', () => {
  it('writes the outbox entry before the row it belongs to', async () => {
    // `useStartAdHocSession` rule (e), same reasoning: if the second write
    // fails, the server still learns the session started. The other order
    // leaves a started row nothing will ever sync.
    await seedScheduled();
    const db = await getLocalDb();
    const observed: string[] = [];
    const insert = db.insert.bind(db);
    const update = db.update.bind(db);
    jest.spyOn(db, 'insert').mockImplementation((table) => {
      observed.push('outbox');
      return insert(table);
    });
    jest.spyOn(db, 'update').mockImplementation((table) => {
      observed.push('session');
      return update(table);
    });

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP, db });

    expect(observed).toEqual(['outbox', 'session']);
    jest.restoreAllMocks();
  });

  it('reads the row it is transitioning by its local key', async () => {
    await seedScheduled();
    const db = await getLocalDb();

    await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP, db });

    const [row] = await db
      .select()
      .from(localWorkoutSessions)
      .where(eq(localWorkoutSessions.clientLocalId, LOCAL_KEY));
    expect(row?.status).toBe('in_progress');
  });
});

describe('what the server actually receives', () => {
  it('validates against the shared schema once the signal comes back', async () => {
    // The task's Verification, at the seam: enqueue offline, flush, and check
    // the input `workouts.start` is called with is the one the API's own Zod
    // schema accepts. `flush.ts` merges the outbox row's `clientLocalId` in,
    // and `strictObject` rejects anything it does not name — so a payload
    // this device can never send would otherwise only be discovered by a
    // client whose workout had already vanished.
    await seedScheduled();
    const started = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const sent: { procedure: string; input: unknown }[] = [];
    const db = await getLocalDb();
    // `enqueueMutation` stamps `next_attempt_at` from the wall clock, not
    // from the injected tap instant, so the flush's own clock has to be ahead
    // of the wall clock for the row to be due.
    await runFlushPass(db, Date.now() + 60_000, {
      send: (procedure, input) => {
        sent.push({ procedure, input });
        return Promise.resolve(null);
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.procedure).toBe(START_PROCEDURE);
    const parsed = workoutsSchemas.startSessionInput.parse(sent[0]?.input);
    expect(parsed.workoutSessionId).toBe(SERVER_ID);
    expect(parsed.startedAt).toEqual(TAP);

    // And the row that carries the chain is still the one later sets hang off.
    const { sessions } = await readRows();
    expect(sessions[0]?.startOutboxId).toBe(started.outboxId);
  });
});

describe('analytics never breaks the start', () => {
  it('still starts the session when the payload will not parse', async () => {
    // `readSessionPayload` throws on genuine corruption, and by the time the
    // event is emitted the session has already started. A throw here would
    // report a successful start as a failure to a client standing in a gym.
    await seedScheduled({ payloadJson: 'not superjson at all' });

    const started = await startSession({ sessionLocalId: LOCAL_KEY, now: () => TAP });

    const { sessions, entries } = await readRows();
    expect(started.outboxId).not.toBeNull();
    expect(sessions[0]?.status).toBe('in_progress');
    expect(entries).toHaveLength(1);
  });
});
