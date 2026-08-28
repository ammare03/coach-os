import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// The finalised auth-screen background (`/design` round 2): the "2 —
// Conservative" layout's nav-bar-only glass, with "1 — Maximal"'s pulse
// rings swapped in for the drifting trend line, expanded from 2 cluster
// positions to 4 so the ambient motion reaches the whole screen, not just
// one corner. Values (scale, opacity, curve, duration) are ported as-is
// from the approved design canvas, not re-derived.
interface RingSpec {
  size: number;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  delay: number;
}

const RING_CLUSTERS: readonly RingSpec[] = [
  // top-right — large
  { size: 120, top: 120, right: -30, delay: 0 },
  { size: 120, top: 120, right: -30, delay: 2000 },
  { size: 120, top: 120, right: -30, delay: 4000 },
  // bottom-left — small
  { size: 90, bottom: 180, left: -20, delay: 1000 },
  { size: 90, bottom: 180, left: -20, delay: 3000 },
  // top-left — small (new cluster)
  { size: 70, top: 40, left: -10, delay: 1500 },
  { size: 70, top: 40, left: -10, delay: 4500 },
  // bottom-right — small (new cluster)
  { size: 80, bottom: 60, right: -15, delay: 500 },
  { size: 80, bottom: 60, right: -15, delay: 3500 },
];

const DURATION = 6000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1); // `animate` skill's strong ease-out for UI

function Ring({ size, top, bottom, left, right, delay }: RingSpec) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = 0.15; // static, dimmed — no movement, per `prefers-reduced-motion`
      return;
    }
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: DURATION, easing: EASE_OUT }), -1, false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `progress` is a stable shared-value ref
  }, [reducedMotion, delay]);

  const style = useAnimatedStyle(() => {
    const scale = 0.55 + progress.value * (1.9 - 0.55);
    const opacity =
      progress.value < 0.7
        ? 0.3 - (progress.value / 0.7) * (0.3 - 0.06)
        : 0.06 * (1 - (progress.value - 0.7) / 0.3);
    return { transform: [{ scale }], opacity: reducedMotion ? 0.1 : opacity };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, top, bottom, left, right },
        style,
      ]}
    />
  );
}

/** Decorative only — `pointerEvents="none"` throughout, never intercepts a touch. */
export function PulseRingBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {RING_CLUSTERS.map((ring, index) => (
        <Ring key={index} {...ring} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#6366F1',
  },
});
