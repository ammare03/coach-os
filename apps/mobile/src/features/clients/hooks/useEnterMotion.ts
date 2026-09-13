import { duration, easing, spacing, useReducedMotion } from '@coachos/ui';
import { useEffect } from 'react';
import type { ViewStyle } from 'react-native';
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

// The Notes tab's one entrance, shared by the re-sorted row and the note
// composer (`code-conventions` §1 — promoted on the second consumer).
//
// **Why this is not `entering=`.** A Reanimated entering animation fires
// whenever the component mounts, and a FlashList v2 cell mounts as the
// recycler grows its pool — which is to say, during a scroll. `DESIGN.md`
// §5 forbids motion on a value the coach is reading, and a list that fades
// each row in as it is reused is exactly that. So the trigger here is a
// *mount-seeded shared value*: a caller that passes `isEntering` is
// asserting "this specific surface arrived because of a tap I just
// handled", and the screen spends that assertion one commit later
// (`ClientNotesScreen`'s `noteEntranceId`). A row that mounts for any other
// reason seeds at its end state and the effect below returns immediately.

/** §5's `fadeup`, at the smallest travel that still reads as arriving. */
const RISE_Y = spacing(8);

const RISE_EASING = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);

export interface EnterMotion {
  durationMs: number;
  riseY: number;
}

/**
 * The two values Reduce Motion changes, split out so the accessibility
 * contract is assertable without reaching into a Reanimated shared value.
 *
 * Reduced motion keeps the state change and drops the travel
 * (`accessibility` §6) — and shortens to `duration.press`, because with no
 * distance left to cover the longer curve only reads as lag.
 */
export function enterMotion(reducedMotion: boolean, durationMs: number): EnterMotion {
  return reducedMotion ? { durationMs: duration.press, riseY: 0 } : { durationMs, riseY: RISE_Y };
}

/**
 * `durationMs` is the full-motion duration — `duration.state` for the pin
 * re-sort (a state change), `duration.enter` for the composer (a surface
 * arriving). Reduce Motion overrides it.
 */
export function useEnterMotion(isEntering: boolean, durationMs: number): AnimatedStyle<ViewStyle> {
  const reducedMotion = useReducedMotion();
  const motion = enterMotion(reducedMotion, durationMs);
  // Seeded at the end state for anything that is not entering, so a row
  // recycled mid-scroll is opaque on its first frame and has nothing to
  // play.
  const enter = useSharedValue(isEntering ? 0 : 1);

  useEffect(() => {
    if (!isEntering) return;
    enter.value = withTiming(1, { duration: motion.durationMs, easing: RISE_EASING });
    // Mount-only, and that is the guarantee: `isEntering` is fixed for this
    // instance's lifetime because the caller keys the element, so a later
    // prop change — which is all a recycle is — cannot re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: motion.riseY * (1 - enter.value) }],
  }));
}
