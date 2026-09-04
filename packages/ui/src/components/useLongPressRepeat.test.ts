import { act, renderHook } from '@testing-library/react-native';

import { REPEAT_CURVE, repeatDelayMs, useLongPressRepeat } from './useLongPressRepeat.ts';

describe('repeatDelayMs', () => {
  it('waits the initial delay before the first repeat', () => {
    expect(repeatDelayMs(0)).toBe(REPEAT_CURVE.initialDelayMs);
  });

  it('starts the ramp at the start interval', () => {
    expect(repeatDelayMs(1)).toBe(REPEAT_CURVE.startIntervalMs);
  });

  it('shortens the interval on every subsequent repeat', () => {
    const intervals = [1, 2, 3, 4, 5, 6].map((n) => repeatDelayMs(n));

    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]).toBeLessThan(intervals[i - 1] ?? Infinity);
    }
  });

  // The failure this guards is an overshoot: a ramp that keeps accelerating
  // adds twenty kilos on a half-second hold, which is worse than no
  // acceleration at all.
  it('never goes below the floor, however long the hold', () => {
    for (let n = 1; n <= 500; n += 1) {
      expect(repeatDelayMs(n)).toBeGreaterThanOrEqual(REPEAT_CURVE.minIntervalMs);
    }
  });

  it('honours an overridden curve', () => {
    const curve = { initialDelayMs: 100, startIntervalMs: 50, minIntervalMs: 10, decayFactor: 0.5 };

    expect(repeatDelayMs(0, curve)).toBe(100);
    expect(repeatDelayMs(1, curve)).toBe(50);
    expect(repeatDelayMs(2, curve)).toBe(25);
    expect(repeatDelayMs(9, curve)).toBe(10);
  });
});

describe('useLongPressRepeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not repeat before the initial delay', () => {
    const onRepeat = jest.fn();
    const { result } = renderHook(() => useLongPressRepeat({ onRepeat }));

    act(() => result.current.start());
    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.initialDelayMs - 1);
    });

    expect(onRepeat).not.toHaveBeenCalled();
    expect(result.current.didRepeat()).toBe(false);
  });

  it('repeats once the initial delay elapses, then accelerates', () => {
    const onRepeat = jest.fn();
    const { result } = renderHook(() => useLongPressRepeat({ onRepeat }));

    act(() => result.current.start());
    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.initialDelayMs);
    });
    expect(onRepeat).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.startIntervalMs);
    });
    expect(onRepeat).toHaveBeenCalledTimes(2);

    // Every gap after the first is shorter than the one before it, so a
    // window that would buy five repeats at a constant interval buys more.
    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.startIntervalMs * 4);
    });
    expect(onRepeat.mock.calls.length).toBeGreaterThan(6);
  });

  it('stops on release and reports that the gesture repeated', () => {
    const onRepeat = jest.fn();
    const { result } = renderHook(() => useLongPressRepeat({ onRepeat }));

    act(() => result.current.start());
    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.initialDelayMs);
    });
    act(() => result.current.stop());
    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(onRepeat).toHaveBeenCalledTimes(1);
    expect(result.current.didRepeat()).toBe(true);
  });

  it('reports no repeat for a press shorter than the initial delay', () => {
    const onRepeat = jest.fn();
    const { result } = renderHook(() => useLongPressRepeat({ onRepeat }));

    act(() => result.current.start());
    act(() => {
      jest.advanceTimersByTime(120);
    });
    act(() => result.current.stop());

    expect(onRepeat).not.toHaveBeenCalled();
    expect(result.current.didRepeat()).toBe(false);
  });

  it('calls the latest onRepeat, not the one captured at press-in', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(
      ({ onRepeat }: { onRepeat: () => void }) => useLongPressRepeat({ onRepeat }),
      { initialProps: { onRepeat: first } },
    );

    act(() => result.current.start());
    rerender({ onRepeat: second });
    act(() => {
      jest.advanceTimersByTime(REPEAT_CURVE.initialDelayMs);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending repeat on unmount', () => {
    const onRepeat = jest.fn();
    const { result, unmount } = renderHook(() => useLongPressRepeat({ onRepeat }));

    act(() => result.current.start());
    unmount();
    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(onRepeat).not.toHaveBeenCalled();
  });
});
