import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "Reduce Motion" setting is on.
 *
 * Subscribed rather than sampled once: it is a live setting a person can
 * toggle while the app is foregrounded, and treating it as a static device
 * capability is the common bug (`accessibility` §5, §6) — same treatment
 * `useGlassAvailable` gives Reduce Transparency and Increase Contrast.
 *
 * The initial async check only calls `setReduced` when it resolves `true`:
 * state already starts `false`, so a `false` result is a no-op write, and
 * skipping it avoids scheduling a state update outside `act()` in every
 * test that mounts a consumer before the promise settles (this was
 * `Toast`'s copy; the other five set unconditionally, which is equivalent
 * in rendered output but noisier under test).
 *
 * Previously six near-identical copies: `apps/mobile/src/lib/useReducedMotion.ts`,
 * `ClientTabBar.tsx`, and one each in `Calendar`, `SegmentedControl`,
 * `Skeleton`, and `Toast`. Consolidated here on the third-consumer rule
 * each copy's own comment already promised.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && value) setReduced(true);
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
