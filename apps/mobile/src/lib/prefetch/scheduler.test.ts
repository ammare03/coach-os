import { toLocalDate } from '@coachos/utils';
import type { NetworkState } from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuthStore } from '../../features/auth/store.ts';
import { resetConnectivityForTests, useConnectivityStore } from '../connectivity/store.ts';
import { publishClientTimeZone, resetClientTimeZoneForTests } from '../time-zone/store.ts';

import {
  PREFETCH_MIN_INTERVAL_MS,
  ensurePrefetchOnForeground,
  resetPrefetchSchedulerForTests,
  runPrefetch,
} from './scheduler.ts';

// `expo-network` reaches a native module with no Jest-side implementation.
// Connectivity is driven through the store directly below; this only keeps
// `ensureConnectivityTracking()` from touching the radio.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() => new Promise<NetworkState>(() => {})),
}));

// The auth store reaches SQLite through `db/wipe.ts` at import time.
jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

// Tasks 01 and 02 are seams: what this task owns is the trigger, the gate,
// and the de-duplication. Each fetcher has its own tests.
// Only the step is a seam. `upcomingRange` stays real: the scheduler
// derives the pass's one day boundary through it, and a stub would let the
// assertions below agree with themselves rather than with the writer.
jest.mock('./sessions.ts', () => ({
  ...jest.requireActual('./sessions.ts'),
  prefetchSessionsAndExercises: jest.fn(),
}));
jest.mock('./foods.ts', () => ({ prefetchFoods: jest.fn() }));
jest.mock('./history.ts', () => ({ prefetchHistory: jest.fn() }));
jest.mock('../outbox/flush.ts', () => ({ flushOutbox: jest.fn() }));

const sessions = jest.requireMock('./sessions.ts') as { prefetchSessionsAndExercises: jest.Mock };
const foods = jest.requireMock('./foods.ts') as { prefetchFoods: jest.Mock };
const history = jest.requireMock('./history.ts') as { prefetchHistory: jest.Mock };
const outbox = jest.requireMock('../outbox/flush.ts') as { flushOutbox: jest.Mock };

let appStateListeners: ((next: AppStateStatus) => void)[] = [];

function emit(next: AppStateStatus): void {
  for (const listener of appStateListeners) listener(next);
}

/** A real return from background — the only transition the trigger acts on. */
function foreground(): void {
  emit('background');
  emit('active');
}

function setConnected(isConnected: boolean): void {
  useConnectivityStore.setState({ isConnected });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function callCounts(): [number, number, number] {
  return [
    sessions.prefetchSessionsAndExercises.mock.calls.length,
    foods.prefetchFoods.mock.calls.length,
    history.prefetchHistory.mock.calls.length,
  ];
}

beforeEach(() => {
  appStateListeners = [];
  // A running app is foregrounded; the Jest environment reports `'unknown'`,
  // which would make the first `'active'` look like a transition.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (next: AppStateStatus) => void,
  ) => {
    appStateListeners.push(handler);
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);

  sessions.prefetchSessionsAndExercises.mockReset().mockResolvedValue(undefined);
  foods.prefetchFoods.mockReset().mockResolvedValue(undefined);
  history.prefetchHistory.mockReset().mockResolvedValue(undefined);
  outbox.flushOutbox.mockReset().mockResolvedValue({ claimed: 0, sent: 0, failed: 0 });

  useAuthStore.getState().setAuthenticated({
    userId: 'user-1',
    role: 'client',
    isOnboarded: true,
  });
  // Offline at registration, so the cold-start pass inside
  // `ensurePrefetchOnForeground()` skips and each test drives its own run.
  setConnected(false);
});

afterEach(() => {
  jest.useRealTimers();
  resetPrefetchSchedulerForTests();
  resetClientTimeZoneForTests();
  resetConnectivityForTests();
  useAuthStore.getState().setSignedOut();
  jest.restoreAllMocks();
});

describe('ensurePrefetchOnForeground', () => {
  it('prefetches sessions, foods, and history when the app foregrounds with connectivity', async () => {
    ensurePrefetchOnForeground();
    setConnected(true);

    foreground();
    await settle();

    expect(callCounts()).toEqual([1, 1, 1]);
  });

  it('skips the run entirely when the app foregrounds offline', async () => {
    ensurePrefetchOnForeground();

    foreground();
    await settle();

    expect(callCounts()).toEqual([0, 0, 0]);
    expect(outbox.flushOutbox).not.toHaveBeenCalled();
  });

  it('returns from the foreground handler while the run is still in flight', async () => {
    sessions.prefetchSessionsAndExercises.mockReturnValue(new Promise<void>(() => {}));
    ensurePrefetchOnForeground();
    setConnected(true);

    foreground();

    // The handler is back and the JS thread is free: nothing awaited the
    // run, so no step has resolved yet. The first step starts a microtask
    // later than the handler returns — `execute()` reads the client's
    // persisted timezone before it derives the pass's day boundary — which
    // is still off the render path and still nothing the caller waits on.
    expect(foods.prefetchFoods).not.toHaveBeenCalled();

    await settle();
    expect(sessions.prefetchSessionsAndExercises).toHaveBeenCalledTimes(1);
    expect(foods.prefetchFoods).not.toHaveBeenCalled();
  });

  it('does not start a second run while one is in flight', async () => {
    let release: (() => void) | undefined;
    sessions.prefetchSessionsAndExercises.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );
    ensurePrefetchOnForeground();
    setConnected(true);

    const first = runPrefetch();
    const second = runPrefetch();

    expect(second).toBe(first);
    release?.();
    await first;
    expect(callCounts()).toEqual([1, 1, 1]);
  });

  it('does not re-run for repeated foreground events inside the minimum interval', async () => {
    ensurePrefetchOnForeground();
    setConnected(true);

    foreground();
    await settle();
    foreground();
    await settle();

    expect(callCounts()).toEqual([1, 1, 1]);
  });

  it('runs again once the minimum interval has passed', async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValue(start);
    ensurePrefetchOnForeground();
    setConnected(true);

    foreground();
    await settle();
    clock.mockReturnValue(start + PREFETCH_MIN_INTERVAL_MS);
    foreground();
    await settle();

    expect(callCounts()).toEqual([2, 2, 2]);
  });

  it('ignores an active event that never left the foreground', async () => {
    ensurePrefetchOnForeground();
    setConnected(true);

    emit('active');
    await settle();

    expect(callCounts()).toEqual([0, 0, 0]);
  });

  it('flushes the outbox on the same foreground event', async () => {
    ensurePrefetchOnForeground();
    setConnected(true);

    foreground();
    await settle();

    expect(outbox.flushOutbox).toHaveBeenCalledTimes(1);
  });

  it('registers exactly one listener however many times it is called', () => {
    ensurePrefetchOnForeground();
    ensurePrefetchOnForeground();

    expect(appStateListeners).toHaveLength(1);
  });

  it('waits for the auth bootstrap before its cold-start pass', async () => {
    useAuthStore.setState({ status: 'loading', userId: null, role: null });
    setConnected(true);

    ensurePrefetchOnForeground();
    await settle();
    expect(callCounts()).toEqual([0, 0, 0]);

    useAuthStore.getState().setAuthenticated({
      userId: 'user-1',
      role: 'client',
      isOnboarded: true,
    });
    await settle();

    expect(callCounts()).toEqual([1, 1, 1]);
  });
});

describe('runPrefetch', () => {
  it('skips when the device is offline', async () => {
    await expect(runPrefetch()).resolves.toEqual({ status: 'skipped', reason: 'offline' });
    expect(callCounts()).toEqual([0, 0, 0]);
  });

  it('skips when nobody is signed in', async () => {
    useAuthStore.getState().setSignedOut();
    setConnected(true);

    await expect(runPrefetch()).resolves.toEqual({ status: 'skipped', reason: 'not-signed-in' });
    expect(callCounts()).toEqual([0, 0, 0]);
  });

  it('skips for a coach — all three reads are client procedures', async () => {
    useAuthStore.getState().setAuthenticated({
      userId: 'coach-1',
      role: 'coach',
      isOnboarded: true,
    });
    setConnected(true);

    await expect(runPrefetch()).resolves.toEqual({ status: 'skipped', reason: 'not-a-client' });
    expect(callCounts()).toEqual([0, 0, 0]);
  });

  it('completes the remaining steps when one of them fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    foods.prefetchFoods.mockRejectedValue(new Error('network'));
    setConnected(true);

    await expect(runPrefetch()).resolves.toEqual({ status: 'completed', failed: ['foods'] });
    expect(callCounts()).toEqual([1, 1, 1]);
  });

  it('forwards the day-boundary options to the two date-ranged fetchers', async () => {
    setConnected(true);
    const now = new Date('2026-08-14T19:00:00Z');

    await runPrefetch({ now, timeZone: 'Asia/Kolkata' });

    expect(sessions.prefetchSessionsAndExercises).toHaveBeenCalledWith({
      now,
      timeZone: 'Asia/Kolkata',
    });
    expect(history.prefetchHistory).toHaveBeenCalledWith({
      now,
      timeZone: 'Asia/Kolkata',
      upcomingOwnsFrom: '2026-08-15',
    });
  });
});

// `docs/UNFORGET.md` S32. The two date-ranged steps divide one
// `local_workout_sessions.payload_json` column by date; a pass in which
// they derive that date from different inputs hands the Today card the
// wrong shape. These pin the inputs, not the outcome —
// `./day-boundary.test.ts` pins the outcome end to end.
describe('one day boundary per pass', () => {
  function optionsPassedTo(step: { mock: { calls: unknown[][] } }): {
    now?: Date;
    timeZone?: string;
    upcomingOwnsFrom?: string;
  } {
    return (step.mock.calls[0]?.[0] ?? {}) as {
      now?: Date;
      timeZone?: string;
      upcomingOwnsFrom?: string;
    };
  }

  it('materialises one instant for the whole pass, even across local midnight', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-08-14T18:29:59.500Z'));
    // The steps are sequential: the foods step is the gap the clock used
    // to move through, leaving history a calendar day ahead of sessions.
    foods.prefetchFoods.mockImplementation(() => {
      jest.setSystemTime(new Date('2026-08-14T18:30:01.000Z'));
      return Promise.resolve();
    });
    setConnected(true);

    await runPrefetch();

    const sessionsNow = optionsPassedTo(sessions.prefetchSessionsAndExercises).now;
    const historyNow = optionsPassedTo(history.prefetchHistory).now;
    expect(sessionsNow).toBeInstanceOf(Date);
    expect(historyNow?.getTime()).toBe(sessionsNow?.getTime());
  });

  it("resolves the zone once, from the client's stored timezone", async () => {
    publishClientTimeZone('Pacific/Kiritimati');
    setConnected(true);

    await runPrefetch();

    expect(optionsPassedTo(sessions.prefetchSessionsAndExercises).timeZone).toBe(
      'Pacific/Kiritimati',
    );
    expect(optionsPassedTo(history.prefetchHistory).timeZone).toBe('Pacific/Kiritimati');
  });

  it('hands history the date the sessions prefetch starts owning, rather than one it recomputes', async () => {
    const now = new Date('2026-08-14T19:00:00Z');
    setConnected(true);

    await runPrefetch({ now, timeZone: 'Asia/Kolkata' });

    expect(optionsPassedTo(history.prefetchHistory).upcomingOwnsFrom).toBe(
      toLocalDate(now, 'Asia/Kolkata'),
    );
  });
});
