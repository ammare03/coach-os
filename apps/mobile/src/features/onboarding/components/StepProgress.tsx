import { createThemedStyles, createThemedValue, radius, spacing, Text } from '@coachos/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

// Shared by both onboarding flows (`coach-onboarding/01`'s Files table
// names it as such), which is why it lives in `components/` rather than
// inside the coach flow — the second consumer is `client-onboarding`, and
// promoting on the second consumer is exactly `code-conventions` §1's rule.

export interface StepProgressProps {
  /** How many steps the flow has, including any gate rendered as step 1. */
  total: number;
  /** 1-based. `current === total` means the last step is on screen, not that the flow is done. */
  current: number;
}

const SEGMENT_HEIGHT = 4;

/**
 * The flow's position, in two channels: a filled-segment row and the
 * "Step 2 of 4" line above it. Both, always — a bar alone encodes progress
 * in colour and length only, which `DESIGN.md` §13 does not accept and a
 * screen reader cannot read at all.
 *
 * The filled segments carry §7's progress-bar treatment — the `brand.mid →
 * brand.DEFAULT` fill over `dataviz.barTrack` — rather than a flat swatch:
 * this is the same "how much of this is done" question a progress bar
 * answers, and reading the same tokens keeps it that way if the ramp moves.
 */
export function StepProgress({ total, current }: StepProgressProps) {
  const themed = useThemedStyles();
  const { progressFill } = useProgressColors();
  const clamped = Math.min(Math.max(current, 1), total);

  return (
    <View style={styles.block}>
      <Text size="body-sm" tone="muted">
        Step {clamped} of {total}
      </Text>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${clamped} of ${total}`}
        accessibilityValue={{ min: 1, max: total, now: clamped }}
      >
        {Array.from({ length: total }, (_, index) =>
          index < clamped ? (
            <LinearGradient
              key={index}
              colors={progressFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.segment}
            />
          ) : (
            <View key={index} style={[styles.segment, themed.segmentEmpty]} />
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing(10) },
  track: { flexDirection: 'row', gap: spacing(6) },
  segment: { flex: 1, height: SEGMENT_HEIGHT, borderRadius: radius.cell },
});

const useThemedStyles = createThemedStyles((theme) => ({
  segmentEmpty: { backgroundColor: theme.dataviz.barTrack },
}));

// `createThemedStyles` builds a `StyleSheet`, and a gradient's `colors` is
// a prop rather than a style — so it is read here instead.
const useProgressColors = createThemedValue((theme) => ({
  progressFill: [theme.colors.brand.mid, theme.colors.brand.DEFAULT] as const,
}));
