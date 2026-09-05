import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { duration, easing, radius as radiusTokens } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

export type SkeletonRadius = keyof typeof radiusTokens;

export interface SkeletonProps {
  /** Defaults to filling the parent, so a skeleton reserves the row it stands in. */
  width?: DimensionValue;
  height: number;
  /** DESIGN.md §1.4's ladder, named by what the shape stands for. `cell` (3px) is the bar. */
  radius?: SkeletonRadius;
  /**
   * Given to **exactly one** skeleton per loading region. A screen made of
   * skeletons is silent to a screen reader unless something says the region
   * is loading (`accessibility` skill §2); every other skeleton in the same
   * region stays hidden so the region reads as one item, not twenty.
   */
  accessibilityLabel?: string | undefined;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
}

// DESIGN.md §4's specular sheen is the system's only sweep, and DS§6.7
// makes the skeleton shimmer "a slow, low-contrast sweep. Not a pulsing
// opacity, which reads as an error." So the geometry is copied from the
// sheen — a 70px strip, `linear-gradient(90deg, colour, transparent)`,
// skewed -18° — with the glass specular white swapped for §9's placeholder
// pair, because a skeleton is an L1 surface and not glass.
const SWEEP_WIDTH = 70;
const SWEEP_SKEW = '-18deg';

// §5 permits five durations; `draw` (1200ms, the 900–1600 band) is the
// slowest, and DS§6.7 asks for slow. `easing.fill` is §5's curve for
// anything that traverses a track.
const SWEEP_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/**
 * Reduce Motion is a live, toggleable setting rather than a static device
 * capability — subscribed, not sampled once, mirroring `SegmentedControl`
 * and `useGlassAvailable`.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => setReduced(value),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * The loading placeholder every cache-first list shows before data lands.
 * `DESIGN.md` §5 forbids "spinners where a skeleton belongs", and `UI-UX.md`
 * §UX4 requires the skeleton to match the real layout — so a skeleton is
 * always given the height the real content will occupy, and nothing shifts
 * when the data arrives.
 *
 * The sweep runs entirely on the UI thread (Reanimated worklet), because a
 * loading state is by definition the moment the JS thread is busiest.
 * Under Reduce Motion there is no sweep at all: the static L1 fill is the
 * placeholder, which is a fallback rather than a removal — nothing is
 * communicated by the movement.
 */
export function Skeleton({
  width = '100%',
  height,
  radius = 'cell',
  accessibilityLabel,
  style,
  testID,
}: SkeletonProps) {
  // The sweep's stops are a gradient prop rather than a style, so they come
  // straight off the theme; the static fill goes through the themed sheet.
  const { skeleton } = useTheme();
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const sweepX = useSharedValue(-SWEEP_WIDTH);

  const isAnimating = !reducedMotion && measuredWidth > 0;

  useEffect(() => {
    if (!isAnimating) return;
    // The prototype's `translateX(-120% → 340%)` is relative to the 70px
    // strip and assumes a ~320px device frame; measuring the container is
    // the port that crosses any width.
    sweepX.value = -SWEEP_WIDTH;
    sweepX.value = withRepeat(
      withTiming(measuredWidth, { duration: duration.draw, easing: SWEEP_EASING }),
      -1,
      false,
    );
    return () => cancelAnimation(sweepX);
    // `sweepX` is a Reanimated shared value: stable identity, not a
    // reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimating, measuredWidth]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sweepX.value }, { skewX: SWEEP_SKEW }],
  }));

  function handleLayout(event: LayoutChangeEvent) {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }

  const accessibilityProps: ViewProps =
    accessibilityLabel === undefined
      ? {
          accessible: false,
          accessibilityElementsHidden: true,
          importantForAccessibility: 'no-hide-descendants',
        }
      : {
          accessible: true,
          accessibilityRole: 'progressbar',
          accessibilityLabel,
          accessibilityState: { busy: true },
        };

  return (
    <View
      {...accessibilityProps}
      testID={testID}
      onLayout={handleLayout}
      style={[themed.base, { width, height, borderRadius: radiusTokens[radius] }, style]}
    >
      {isAnimating && (
        <Animated.View pointerEvents="none" style={[styles.sweep, sweepStyle]}>
          <LinearGradient
            colors={skeleton.sweep}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SWEEP_WIDTH,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  base: {
    backgroundColor: theme.skeleton.base,
    overflow: 'hidden',
  },
}));
