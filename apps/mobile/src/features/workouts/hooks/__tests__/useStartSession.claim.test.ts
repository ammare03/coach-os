import { TRPCClientError } from '@trpc/client';
import type { UpcomingSession } from 'api/src/features/workouts/upcoming.ts';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import { attemptStart, type ClaimCheck } from '../useStartSession.ts';

// `phase-09-workout-logger/session-runtime/08`'s claim seam. Four things
// have to be true, and three of them are ways a client standing in a gym
// ends up unable to log:
//
//   - an offline start never asks the server anything,
//   - a claim call that FAILS still lets the client in,
//   - only a live claim held elsewhere stops the start, and it writes nothing,
//   - a transfer refetches server truth BEFORE the local write.
//
// The transferring device's refetch is the one that prevents the duplicate
// coming back through the transfer door, so its ordering is asserted
// directly rather than inferred.

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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const TAP = new Date('2026-08-14T19:00:00.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const LOCAL_KEY = '018f4b1e-0000-7000-8000-0000000000aa';

function upcomingSession(): UpcomingSession {
  return {
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    assignmentId: '018f4b1e-0000-7000-8000-0000000000bb',
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
  } as UpcomingSession;
}

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

async function readSessionRow() {
  const db = await getLocalDb();
  const [row] = await db.select().from(localWorkoutSessions);
  return row;
}

async function countQueued(): Promise<number> {
  const db = await getLocalDb();
  return db.all<{ id: string }>(sql`SELECT id FROM outbox`).length;
}

/**
 * A `SESSION_CLAIMED_ELSEWHERE` in the shape the wire actually delivers.
 * A real `TRPCClientError`, not a look-alike: `lib/error-code.ts` narrows on
 * `instanceof` before it reads `data`, so a plain `Error` carrying the same
 * fields is silently treated as an unknown failure — which would make this
 * whole path pass its tests and fail on a device.
 */
function claimedElsewhereError(): TRPCClientError<never> {
  const error = new TRPCClientError<never>('claimed elsewhere');
  return Object.assign(error, {
    data: { code: 'CONFLICT', httpStatus: 409, appCode: 'SESSION_CLAIMED_ELSEWHERE' },
  });
}

// The parameter is named rather than elided: a zero-arg implementation infers
// an empty args tuple, which is not assignable to `ClaimCheck` under
// `exactOptionalPropertyTypes` — and the tests below assert on
// `toHaveBeenCalledWith`, so the args tuple is the part that has to be right.
const claimReturning = (outcome: string): jest.MockedFunction<ClaimCheck> =>
  jest.fn(async (_input: Parameters<ClaimCheck>[0]) => ({ outcome }));

describe('an offline start', () => {
  it('never asks the server anything', async () => {
    // The task's named risk, and the whole reason the product exists. A
    // claim check on this path is a network dependency in a gym basement.
    await seedScheduled();
    const claim = claimReturning('claimed');

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: false,
      claim,
      now: () => TAP,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(result.kind).toBe('started');
    expect((await readSessionRow())?.status).toBe('in_progress');
  });

  it('re-enters a row the server has never confirmed, with no claim to make', async () => {
    // A session started while offline whose outbox entry has not flushed:
    // there is no server row to claim, so the check is skipped even though
    // the device is back online. It must not become a reason to refuse —
    // this client is mid-workout.
    await seedScheduled({ status: 'in_progress', startedAt: TAP.getTime(), serverId: null });
    const claim = claimReturning('claimed');

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim,
      now: () => TAP,
    });

    expect(claim).not.toHaveBeenCalled();
    expect(result.kind).toBe('started');
  });
});

describe('an online start', () => {
  it('claims the session before writing anything locally', async () => {
    await seedScheduled();
    const claim = claimReturning('claimed');

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim,
      now: () => TAP,
    });

    // No instant crosses the wire — the server times the claim off its own
    // clock. The tap's instant is still captured, but it is `started_at`,
    // which the outbox replays and which is the device's to report.
    expect(claim).toHaveBeenCalledWith({
      workoutSessionId: SERVER_ID,
      transfer: false,
    });
    expect(result).toMatchObject({ kind: 'started', transferred: false, caughtUp: true });
  });

  it('proceeds into the logger when the claim call itself fails', async () => {
    // A timeout or a 500 is not a refusal. Failing closed here strands a
    // client over an outage they cannot see or fix.
    await seedScheduled();
    const claim = jest.fn<ReturnType<ClaimCheck>, Parameters<ClaimCheck>>(async () => {
      throw new Error('network request failed');
    });

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim,
      now: () => TAP,
    });

    expect(result.kind).toBe('started');
    expect((await readSessionRow())?.status).toBe('in_progress');
  });
});

describe('a session another device is logging', () => {
  it('stops the start and writes nothing at all', async () => {
    await seedScheduled();
    const claim = jest.fn<ReturnType<ClaimCheck>, Parameters<ClaimCheck>>(async () => {
      throw claimedElsewhereError();
    });

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim,
      now: () => TAP,
    });

    expect(result).toEqual({ kind: 'claimed-elsewhere' });
    // A client who cancels the sheet is exactly where they started: the row
    // is untouched and no mutation is waiting to tell the server otherwise.
    const row = await readSessionRow();
    expect(row?.status).toBe('scheduled');
    expect(row?.startedAt).toBeNull();
    expect(row?.syncState).toBe('synced');
    expect(await countQueued()).toBe(0);
  });

  it('takes the claim on “Continue here” and reaches a loggable state in one call', async () => {
    // The acceptance criterion that outranks the rest: one tap of the sheet
    // gets the client logging.
    await seedScheduled();
    const claim = claimReturning('transferred');

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      transfer: true,
      claim,
      refetchServerTruth: async () => undefined,
      now: () => TAP,
    });

    expect(claim).toHaveBeenCalledWith({
      workoutSessionId: SERVER_ID,
      transfer: true,
    });
    expect(result).toMatchObject({ kind: 'started', transferred: true, caughtUp: true });
    expect((await readSessionRow())?.status).toBe('in_progress');
  });
});

describe('the transfer’s refetch', () => {
  it('runs before the local start write, never after it', async () => {
    // Taking ownership while holding a stale set list is how the duplicate
    // comes back through the transfer door: the device re-enqueues sets that
    // already synced. Ordering is the guarantee, so ordering is asserted.
    await seedScheduled();
    const order: string[] = [];
    const refetchServerTruth = jest.fn(async () => {
      order.push(`refetch:${(await readSessionRow())?.status ?? 'gone'}`);
    });

    await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      transfer: true,
      claim: claimReturning('transferred'),
      refetchServerTruth,
      now: () => TAP,
    });

    order.push(`start:${(await readSessionRow())?.status ?? 'gone'}`);
    expect(order).toEqual(['refetch:scheduled', 'start:in_progress']);
  });

  it('does not run when the claim was simply free', async () => {
    // Nobody else logged into this session, so there is nothing to catch up
    // on and no reason to spend a round trip in front of the client.
    await seedScheduled();
    const refetchServerTruth = jest.fn(async () => undefined);

    await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim: claimReturning('claimed'),
      refetchServerTruth,
      now: () => TAP,
    });

    expect(refetchServerTruth).not.toHaveBeenCalled();
  });

  it('still starts the session when the catch-up fails, and says so', async () => {
    // Best effort. A retry loop in front of someone holding a barbell is the
    // failure this rule exists to avoid, not one worth introducing.
    await seedScheduled();

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      transfer: true,
      claim: claimReturning('transferred'),
      refetchServerTruth: async () => {
        throw new Error('network request failed');
      },
      now: () => TAP,
    });

    expect(result).toMatchObject({ kind: 'started', transferred: true, caughtUp: false });
    expect((await readSessionRow())?.status).toBe('in_progress');
  });
});

describe('re-entering a paused session', () => {
  it('still settles the claim, because another device may have taken it', async () => {
    // "Continue" is a start action. `startSession` short-circuits on a row
    // already in progress; the claim ahead of it does not.
    await seedScheduled({ status: 'in_progress', startedAt: TAP.getTime() });
    const claim = claimReturning('renewed');

    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim,
      now: () => TAP,
    });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('started');
  });
});

describe('a mirror that will not answer', () => {
  it('reports a failure rather than opening an empty logger', async () => {
    // No row at all — `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED` territory.
    const result = await attemptStart({
      sessionLocalId: LOCAL_KEY,
      isConnected: true,
      claim: claimReturning('claimed'),
      now: () => TAP,
    });

    expect(result).toEqual({ kind: 'failed' });
  });
});
