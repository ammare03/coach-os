import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '../theme/tokens.ts';

export type GlassSurfaceStyle = 'regular' | 'clear';

export interface GlassSurfaceProps {
  style?: GlassSurfaceStyle;
  interactive?: boolean;
  children?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * The DS§12 three-way resolution, minimal version: `expo-glass-effect` is
 * imported in exactly this one file (the AC every later screen depends
 * on) — no screen imports it directly. Chrome only: this task's design
 * uses it for a nav bar strip, never a content surface.
 *
 * Deferred to the real `phase-04-design-system/ui-primitives-core/07`:
 * `GlassSurfaceGroup`, the white-label tint clamp, and Increase Contrast
 * handling. Reduce Transparency IS handled and re-renders live, since
 * `AccessibilityInfo` already provides that for free.
 */
export function GlassSurface({
  style = 'regular',
  interactive = false,
  children,
  containerStyle,
}: GlassSurfaceProps) {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then((value) => {
      if (mounted) setReduceTransparency(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (value: boolean) => {
        setReduceTransparency(value);
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const canUseGlass = Platform.OS === 'ios' && isLiquidGlassAvailable() && !reduceTransparency;

  if (canUseGlass) {
    return (
      <GlassView glassEffectStyle={style} isInteractive={interactive} style={containerStyle}>
        {children}
      </GlassView>
    );
  }

  // Opaque fallback — DS§5's `bg.raised`, never a translucent
  // approximation (DS§10 rejects emulated glassmorphism outright).
  return <View style={[styles.fallback, containerStyle]}>{children}</View>;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.bg.raised,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
});
