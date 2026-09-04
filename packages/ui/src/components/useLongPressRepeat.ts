import { useEffect, useRef } from 'react';

/**
 * The acceleration curve, as data. Lives apart from the hook so the ramp can
 * be asserted without a renderer (`ui-primitives-data/01`) — getting it wrong
 * in the fast direction overshoots by twenty kilos on a half-second hold,
 * which is worse for the client than no acceleration at all.
 *
 * Tuned conservatively on purpose: a slightly slow ramp is recoverable, an
 * overshoot is not, and the reference device is a mid-range Android
 * (`CLAUDE.md` §19), not the phone this was written on.
 */
export const REPEAT_CURVE = {
  /** Before the first repeat. A tap shorter than this never repeats. */
  initialDelayMs: 400,
  /** Between the first and second repeat. */
  startIntervalMs: 250,
  /** The floor. The interval never goes below this, however long the hold. */
  minIntervalMs: 60,
  /** Applied once per repeat: 250 → 205 → 168 → … → 60. */
  decayFactor: 0.82,
} as const;

export interface RepeatCurve {
  initialDelayMs?: number;
  startIntervalMs?: number;
  minIntervalMs?: number;
  decayFactor?: number;
}

/**
 * The delay before repeat number `repeatsFired + 1`. `repeatsFired === 0` is
 * the initial delay, so one function describes the whole schedule.
 */
export function repeatDelayMs(repeatsFired: number, curve: RepeatCurve = {}): number {
  const {
    initialDelayMs = REPEAT_CURVE.initialDelayMs,
    startIntervalMs = REPEAT_CURVE.startIntervalMs,
    minIntervalMs = REPEAT_CURVE.minIntervalMs,
    decayFactor = REPEAT_CURVE.decayFactor,
  } = curve;

  if (repeatsFired <= 0) return initialDelayMs;
  return Math.max(minIntervalMs, Math.round(startIntervalMs * decayFactor ** (repeatsFired - 1)));
}

export interface UseLongPressRepeatOptions extends RepeatCurve {
  /** Fired once per repeat. The press itself is the caller's — this hook only repeats it. */
  onRepeat: () => void;
}

export interface LongPressRepeat {
  /** Call on press-in. Resets the ramp and schedules the first repeat. */
  start: () => void;
  /** Call on press-out. Stops the ramp; leaves `didRepeat` readable. */
  stop: () => void;
  /**
   * Whether the gesture that just ended produced at least one repeat. React
   * Native fires `onPressOut` before `onPress`, so a caller reads this in
   * `onPress` to suppress the extra step a long press would otherwise land
   * after the finger lifts — the overshoot the device verification checks for.
   */
  didRepeat: () => boolean;
}

/**
 * Accelerating repeat for a held control. Timer-driven rather than
 * interval-driven, because the interval shortens on every tick.
 *
 * Deliberately fires nothing itself: no haptics (`ui-conventions` §5 permits
 * `Light` on **set logged**, and a long press would produce twenty a second),
 * no animation, no state of its own beyond the ramp.
 */
export function useLongPressRepeat({
  onRepeat,
  ...curve
}: UseLongPressRepeatOptions): LongPressRepeat {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatsRef = useRef(0);
  const didRepeatRef = useRef(false);
  const onRepeatRef = useRef(onRepeat);
  const curveRef = useRef<RepeatCurve>(curve);

  // The latest-ref pattern, and it is load-bearing: `onRepeat` closes over
  // the controlled `value` prop, so a version captured at press-in would
  // step from the same starting number on every repeat.
  useEffect(() => {
    onRepeatRef.current = onRepeat;
    curveRef.current = curve;
  });

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const stop = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const schedule = (): void => {
    timeoutRef.current = setTimeout(
      () => {
        repeatsRef.current += 1;
        didRepeatRef.current = true;
        onRepeatRef.current();
        schedule();
      },
      repeatDelayMs(repeatsRef.current, curveRef.current),
    );
  };

  const start = () => {
    stop();
    repeatsRef.current = 0;
    didRepeatRef.current = false;
    schedule();
  };

  return { start, stop, didRepeat: () => didRepeatRef.current };
}
