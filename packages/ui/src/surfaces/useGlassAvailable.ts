import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export interface GlassAvailability {
  /** Static: true only on iOS hardware capable of real Liquid Glass. */
  capable: boolean;
  /** Live: Reduce Transparency, subscribed rather than sampled once. */
  reduceTransparency: boolean;
  /** Live: Increase Contrast (`isDarkerSystemColorsEnabled` on iOS, `isHighTextContrastEnabled` on Android). */
  increaseContrast: boolean;
  /** `!reduceTransparency && !increaseContrast` — either one alone forces the opaque fallback. */
  transparencyAllowed: boolean;
  /** The actual render decision: `capable && transparencyAllowed`. */
  canUseGlass: boolean;
}

/**
 * Resolves whether a `<GlassSurface>` may render real Liquid Glass right
 * now. `capable` never changes after mount; `reduceTransparency` and
 * `increaseContrast` are live OS settings — toggling either while the app
 * is foregrounded must take effect without a relaunch
 * (`accessibility` skill §5), so both are subscribed via `AccessibilityInfo`
 * rather than read once.
 */
export function useGlassAvailable(): GlassAvailability {
  // A static device capability (OS + hardware) — the lazy `useState`
  // initialiser runs exactly once per hook instance, on mount, never on a
  // later render (`ui-primitives-core/07` approach §1's "evaluate it once
  // and memoise"), and unlike a true module-scope constant it re-resolves
  // per test/per remount rather than being frozen for the life of the JS
  // engine, which is what actually makes this hook unit-testable.
  const [capable] = useState(() => Platform.OS === 'ios' && isLiquidGlassAvailable());
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [increaseContrast, setIncreaseContrast] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (Platform.OS === 'ios') {
      void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
        if (mounted) setReduceTransparency(value);
      });
      // iOS's "Increase Contrast" setting is exposed as "darker system
      // colors" in `AccessibilityInfo`.
      void AccessibilityInfo.isDarkerSystemColorsEnabled().then((value) => {
        if (mounted) setIncreaseContrast(value);
      });
    } else if (Platform.OS === 'android') {
      void AccessibilityInfo.isHighTextContrastEnabled().then((value) => {
        if (mounted) setIncreaseContrast(value);
      });
    }

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            AccessibilityInfo.addEventListener('reduceTransparencyChanged', (value: boolean) => {
              setReduceTransparency(value);
            }),
            AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (value: boolean) => {
              setIncreaseContrast(value);
            }),
          ]
        : Platform.OS === 'android'
          ? [
              AccessibilityInfo.addEventListener('highTextContrastChanged', (value: boolean) => {
                setIncreaseContrast(value);
              }),
            ]
          : [];

    return () => {
      mounted = false;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  const transparencyAllowed = !reduceTransparency && !increaseContrast;

  return {
    capable,
    reduceTransparency,
    increaseContrast,
    transparencyAllowed,
    canUseGlass: capable && transparencyAllowed,
  };
}
