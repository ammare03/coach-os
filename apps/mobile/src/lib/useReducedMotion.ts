import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "Reduce Motion" setting is on.
 *
 * Subscribed rather than sampled once: it is a live setting a person can
 * toggle while the app is foregrounded, and treating it as a static device
 * capability is the common bug (`accessibility` §5, §6).
 *
 * `packages/ui` carries three private copies of this (`Skeleton`,
 * `SegmentedControl`, `Toast`), each with a note to extract it on the third
 * consumer. This is the first one in `apps/mobile`, and it lives here rather
 * than in `packages/ui` because that package exports components, not hooks —
 * pulling it across would be an API decision this task has no business
 * making. When `packages/ui` does extract its own, this should import it.
 *
 * Under Reduce Motion, `DESIGN.md` §13's rule is "disable the drift, sheen,
 * parallax and self-drawing strokes; keep opacity fades and instant state
 * changes" — so a consumer sets a duration of `0`, it does not skip the
 * state change.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
