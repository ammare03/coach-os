import {
  DEFAULT_REST_SECONDS,
  resetRestTimerForTests,
  resolveRestSeconds,
  useRestTimerStore,
} from '../rest-timer-store.ts';

// `phase-09-workout-logger/rest-timer/01`. Four things have to be true, and
// three of them are ways a client reads a rest they are not actually taking:
// the target is the coach's, the countdown is derived from the clock rather
// than accumulated, a second set restarts rather than stacks, and zero ends
// it exactly once.

const timer = () => useRestTimerStore.getState();

afterEach(() => {
  resetRestTimerForTests();
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
    timer().startRest(120, 0);

    expect(timer()).toMatchObject({
      isRunning: true,
      targetSeconds: 120,
      remainingSeconds: 120,
    });
  });

  it('runs from the default when the exercise carries no rest target', () => {
    timer().startRest(null, 0);

    expect(timer()).toMatchObject({ isRunning: true, targetSeconds: DEFAULT_REST_SECONDS });
  });

  it('is already over when the coach prescribed no rest', () => {
    timer().startRest(0, 0);

    expect(timer()).toMatchObject({ isRunning: false, targetSeconds: 0, remainingSeconds: 0 });
  });

  it('restarts rather than stacks when the next set is logged mid-rest', () => {
    timer().startRest(90, 0);
    timer().tick(30_000);
    expect(timer().remainingSeconds).toBe(60);

    timer().startRest(90, 30_000);

    expect(timer().remainingSeconds).toBe(90);
    // Anchored to the new set, not the old one.
    timer().tick(31_000);
    expect(timer().remainingSeconds).toBe(89);
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
    timer().startRest(90, 0);
    timer().tick(1_000);
    expect(timer().remainingSeconds).toBe(89);

    // The OS froze the interval for twenty minutes. An accumulated counter
    // would read 88 here; the rest is long over.
    timer().tick(20 * 60 * 1_000);

    expect(timer()).toMatchObject({ isRunning: false, remainingSeconds: 0 });
  });

  it('ignores a tick once the rest is over', () => {
    timer().startRest(5, 0);
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
});
