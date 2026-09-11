import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import {
  DEFAULT_REST_SECONDS,
  ensureRestTimerForegroundSync,
  resetRestTimerForTests,
  resolveRestSeconds,
  selectRestAnchor,
  useRestTimerStore,
} from '../rest-timer-store.ts';

// `phase-09-workout-logger/rest-timer/01`. Four things have to be true, and
// three of them are ways a client reads a rest they are not actually taking:
// the target is the coach's, the countdown is derived from the clock rather
// than accumulated, a second set restarts rather than stacks, and zero ends
// it exactly once.
//
// `rest-timer/02` adds the three the same client hits after locking their
// phone: the rest is anchored to a session so a stale one cannot come back,
// an anchor read off disk resolves against the real clock rather than
// restarting, and the first foreground recomputes without waiting for an
// interval the OS stopped calling.

const timer = () => useRestTimerStore.getState();

/**
 * Captures the handler the store registers rather than emitting on
 * `AppState`: jest-expo's mock has no event emitter, and driving the
 * subscription that was actually registered is the more direct check
 * (`hooks/__tests__/useSessionKeepAwake.test.tsx` does the same).
 */
function captureAppState() {
  const listener: { onChange?: (state: AppStateStatus) => void; remove: jest.Mock } = {
    remove: jest.fn(),
  };
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, handler: (state: AppStateStatus) => void) => {
      listener.onChange = handler;
      return { remove: listener.remove } as unknown as NativeEventSubscription;
    });
  return listener;
}

afterEach(() => {
  resetRestTimerForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('resolveRestSeconds', () => {
  it("uses the coach's target when the exercise has one", () => {
    expect(resolveRestSeconds(120)).toBe(120);
  });

  it('falls back to the default for an exercise with no target', () => {
    expect(resolveRestSeconds(null)).toBe(DEFAULT_REST_SECONDS);
  });

  it('falls back to the default for an ad-hoc session, which has no prescription at all', () => {
    expect(resolveRestSeconds(undefined)).toBe(DEFAULT_REST_SECONDS);
  });

  it('keeps a coach-set zero, rather than substituting a rest they did not ask for', () => {
    expect(resolveRestSeconds(0)).toBe(0);
  });
});

describe('startRest', () => {
  it('runs from the target the coach set', () => {
    timer().startRest(120, { nowMs: 0 });

    expect(timer()).toMatchObject({
      isRunning: true,
      targetSeconds: 120,
      remainingSeconds: 120,
    });
  });

  it('runs from the default when the exercise carries no rest target', () => {
    timer().startRest(null, { nowMs: 0 });

    expect(timer()).toMatchObject({ isRunning: true, targetSeconds: DEFAULT_REST_SECONDS });
  });

  it('is already over when the coach prescribed no rest', () => {
    timer().startRest(0, { nowMs: 0 });

    expect(timer()).toMatchObject({ isRunning: false, targetSeconds: 0, remainingSeconds: 0 });
  });

  it('restarts rather than stacks when the next set is logged mid-rest', () => {
    timer().startRest(90, { nowMs: 0 });
    timer().tick(30_000);
    expect(timer().remainingSeconds).toBe(60);

    timer().startRest(90, { nowMs: 30_000 });

    expect(timer().remainingSeconds).toBe(90);
    // Anchored to the new set, not the old one.
    timer().tick(31_000);
    expect(timer().remainingSeconds).toBe(89);
  });

  it('remembers the session the rest belongs to', () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });

    expect(timer().sessionLocalId).toBe('local-7');
  });
});

describe('the countdown', () => {
  it('ticks down once a second on its own', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    timer().startRest(5);
    jest.advanceTimersByTime(3_000);

    expect(timer().remainingSeconds).toBe(2);
  });

  it('stops itself at zero', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);

    timer().startRest(5);
    jest.advanceTimersByTime(5_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
    // The target survives completion — a finished rest still knows what it was.
    expect(timer().targetSeconds).toBe(5);
  });

  it('derives what is left from the clock, so a throttled tick does not under-count', () => {
    timer().startRest(90, { nowMs: 0 });
    timer().tick(1_000);
    expect(timer().remainingSeconds).toBe(89);

    // The OS froze the interval for twenty minutes. An accumulated counter
    // would read 88 here; the rest is long over.
    timer().tick(20 * 60 * 1_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
  });

  it('ignores a tick once the rest is over', () => {
    timer().startRest(5, { nowMs: 0 });
    timer().tick(10_000);
    expect(timer().isRunning).toBe(false);

    timer().tick(20_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0, targetSeconds: 5 });
  });
});

describe('stopRest', () => {
  it('returns the timer to idle and leaves nothing ticking', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    timer().startRest(90);

    timer().stopRest();
    jest.advanceTimersByTime(10_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0, targetSeconds: 0 });
  });

  it('forgets the session, so nothing is left to persist', () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });

    timer().stopRest();

    expect(timer().sessionLocalId).toBeNull();
  });
});

describe('stopRestForSession', () => {
  it('ends the rest the finished session started', () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });

    timer().stopRestForSession('local-7');

    expect(timer()).toMatchObject({ isRunning: false, sessionLocalId: null });
  });

  it("leaves another session's rest alone", () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });

    timer().stopRestForSession('local-8');

    expect(timer()).toMatchObject({ isRunning: true, sessionLocalId: 'local-7' });
  });
});

describe('selectRestAnchor', () => {
  it('is null while nothing is resting, so nothing is persisted', () => {
    expect(selectRestAnchor(timer())).toBeNull();
  });

  it('carries the three values a cold start needs to rebuild the rest', () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 1_000 });

    expect(selectRestAnchor(timer())).toEqual({
      sessionLocalId: 'local-7',
      startedAtMs: 1_000,
      targetSeconds: 90,
    });
  });

  it('is null once the rest reaches zero — a rest that is over is not one to restore', () => {
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });
    timer().tick(90_000);

    expect(selectRestAnchor(timer())).toBeNull();
  });

  it('is null for a rest nobody named a session for, which nothing could scope on a cold start', () => {
    timer().startRest(90, { nowMs: 0 });

    expect(selectRestAnchor(timer())).toBeNull();
  });
});

describe('resumeRest', () => {
  const ANCHOR = { sessionLocalId: 'local-7', startedAtMs: 10_000, targetSeconds: 90 };

  it('restores a rest still in flight with the time that actually elapsed, not the whole target', () => {
    timer().resumeRest(ANCHOR, 40_000);

    expect(timer()).toMatchObject({
      isRunning: true,
      targetSeconds: 90,
      remainingSeconds: 60,
      startedAtMs: 10_000,
      sessionLocalId: 'local-7',
    });
  });

  it('resolves a rest that ran out while the process was dead to finished, never restarting it', () => {
    timer().resumeRest(ANCHOR, 10_000 + 200_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
  });

  it('keeps what the expired rest was and when it began, so the alert can tell what ended', () => {
    timer().resumeRest(ANCHOR, 10_000 + 200_000);

    expect(timer()).toMatchObject({ targetSeconds: 90, startedAtMs: 10_000 });
  });

  it('leaves nothing armed for a rest that was already over', () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000 + 200_000);

    timer().resumeRest(ANCHOR, 10_000 + 200_000);
    jest.advanceTimersByTime(10_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
  });

  it('keeps counting a restored rest on its own', () => {
    jest.useFakeTimers();
    jest.setSystemTime(40_000);

    timer().resumeRest(ANCHOR, 40_000);
    jest.advanceTimersByTime(3_000);

    expect(timer().remainingSeconds).toBe(57);
  });

  it('starts a future-dated anchor now, for a device whose clock moved backwards', () => {
    timer().resumeRest({ ...ANCHOR, startedAtMs: 500_000 }, 40_000);

    expect(timer()).toMatchObject({ isRunning: true, remainingSeconds: 90, startedAtMs: 40_000 });
  });
});

describe('ensureRestTimerForegroundSync', () => {
  it('recomputes the rest on the first foreground, without waiting for an interval the OS stopped calling', () => {
    const appState = captureAppState();
    ensureRestTimerForegroundSync();
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });
    jest.spyOn(Date, 'now').mockReturnValue(30_000);

    appState.onChange?.('active');

    expect(timer().remainingSeconds).toBe(60);
  });

  it('shows a rest that ran out behind a locked screen as over, not still mid-count', () => {
    const appState = captureAppState();
    ensureRestTimerForegroundSync();
    timer().startRest(90, { sessionLocalId: 'local-7', nowMs: 0 });
    // The client locked the phone and came back five minutes later.
    jest.spyOn(Date, 'now').mockReturnValue(5 * 60 * 1_000);

    appState.onChange?.('active');

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
  });

  it('registers exactly one listener however many times it is called', () => {
    const appState = captureAppState();

    ensureRestTimerForegroundSync();
    ensureRestTimerForegroundSync();
    ensureRestTimerForegroundSync();

    expect(appState.onChange).toBeDefined();
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no rest is running', () => {
    const appState = captureAppState();
    ensureRestTimerForegroundSync();
    jest.spyOn(Date, 'now').mockReturnValue(30_000);

    appState.onChange?.('active');

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0, targetSeconds: 0 });
  });
});
