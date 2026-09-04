import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { control, duration, easing, radius, selectionPill, type Density } from '../theme/tokens.ts';

import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

// Two to four options, capped in the TYPE — a fifth option is a `Select`
// or navigation, never a fifth segment (`ui-primitives-core/05`'s AC: "more
// than four options is a type error").
export type SegmentedOptions<V extends string> =
  | readonly [SegmentOption<V>, SegmentOption<V>]
  | readonly [SegmentOption<V>, SegmentOption<V>, SegmentOption<V>]
  | readonly [SegmentOption<V>, SegmentOption<V>, SegmentOption<V>, SegmentOption<V>];

export interface SegmentedControlProps<V extends string> {
  options: SegmentedOptions<V>;
  value: V;
  onChange: (value: V) => void;
  /**
   * Accepted for interface consistency (CONTRACT.md rule 4); DESIGN.md §9
   * gives one literal geometry for this control with no coach/client
   * variant, so it is currently a no-op — see `Chip`'s identical note.
   */
  density?: Density;
  testID?: string;
}

const TRACK_PADDING = 5;
const ITEM_HEIGHT = 38;
// CONTRACT.md rule 3 — the 44px floor is taller than the 38px visual item;
// symmetric vertical `hitSlop` reaches it without growing the track.
const ITEM_HIT_SLOP = { top: 3, bottom: 3, left: 0, right: 0 };
// DESIGN.md §9 — `bg.inset` (`#131A29` = rgb(19,26,41)) at 60%. The track
// NEVER recolours; only the pill moves.
const TRACK_BACKGROUND = control.track;

const fillEasing = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/**
 * Reduce Motion is a live, toggleable accessibility setting, not a static
 * device capability — subscribed rather than sampled once, mirroring
 * `useGlassAvailable`'s treatment of Reduce Transparency.
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
 * A two-to-four-option single-select switcher with a sliding selection
 * pill (DESIGN.md §9). One choice from a fixed, always-visible small set —
 * the whole difference from `Chip`, which is zero-or-more from an open set
 * that may wrap.
 *
 * The pill animates on the UI thread via Reanimated, `duration.state` +
 * `easing.fill`. Under reduced motion it jumps to the new position instead
 * of sliding — it does not fade and does not stay put, because the state
 * change itself is never optional, only its animation is
 * (`ui-primitives-core/05` approach §5).
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  testID,
}: SegmentedControlProps<V>) {
  const count = options.length;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const reducedMotion = useReducedMotion();

  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth > 0 ? trackWidth / count : 0;
  const pillX = useSharedValue(0);

  useEffect(() => {
    const target = selectedIndex * segmentWidth;
    if (reducedMotion) {
      pillX.value = target;
    } else {
      pillX.value = withTiming(target, { duration: duration.state, easing: fillEasing });
    }
    // `pillX` is a Reanimated shared value: stable identity, not a
    // reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, segmentWidth, reducedMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    width: segmentWidth,
    transform: [{ translateX: pillX.value }],
  }));

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(Math.max(0, event.nativeEvent.layout.width - TRACK_PADDING * 2));
  }

  return (
    <View
      testID={testID}
      onLayout={handleLayout}
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          borderRadius: radius.card,
          padding: TRACK_PADDING,
          height: ITEM_HEIGHT + TRACK_PADDING * 2,
        },
      ]}
    >
      {segmentWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            pillStyle,
            {
              top: TRACK_PADDING,
              left: TRACK_PADDING,
              height: ITEM_HEIGHT,
              borderRadius: radius.control,
            },
            selectionPill.shadow,
          ]}
        >
          <LinearGradient
            colors={selectionPill.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[styles.hairlineTop, { backgroundColor: selectionPill.highlight }]}
          />
        </Animated.View>
      ) : null}

      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            hitSlop={ITEM_HIT_SLOP}
            accessibilityRole="tab"
            accessibilityLabel={`${option.label}, tab ${index + 1} of ${count}`}
            accessibilityState={{ selected }}
            containerStyle={styles.segmentOuter}
            style={styles.segment}
          >
            <Text size="label" tone={selected ? 'bright' : 'muted'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: TRACK_BACKGROUND,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    overflow: 'hidden',
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  segmentOuter: {
    flex: 1,
  },
  segment: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
