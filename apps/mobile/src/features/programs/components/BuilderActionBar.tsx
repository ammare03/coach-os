import { Button, GlassSurface, radius, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

// The builder's bottom action bar — tier-1 glass, floating clear of the
// content at `bottom: 26` (`program-builder/01`, frame 1a; `DESIGN.md` §4
// and §9).
//
// Glass is chrome, never content (`ui-conventions` §5), and `GlassSurface`
// is the only implementation — a screen never imports `expo-glass-effect`
// or hand-rolls the platform check. Labels use the `glass` text ramp, which
// clears 4.5:1 against the opaque fallback the surface falls back to under
// Reduce Transparency.

export const ACTION_BAR_BOTTOM = 26;

export interface BuilderActionBarProps {
  /** The draft line — states the fact, offers no apology (`COPY.md` §CO4.1). */
  statusText: string;
  /**
   * Wired by `assignment`, which is what publishing actually is. Absent
   * here on purpose: the affordance stays where the design put it, and the
   * button is inert and says why rather than pretending to work.
   */
  onPublish?: (() => void) | undefined;
  isPublishDisabled?: boolean;
  publishHint?: string | undefined;
  testID?: string;
}

export function BuilderActionBar({
  statusText,
  onPublish,
  isPublishDisabled = false,
  publishHint,
  testID,
}: BuilderActionBarProps) {
  return (
    <View style={styles.dock} pointerEvents="box-none">
      <GlassSurface tier="tier1" style={styles.bar} {...(testID ? { testID } : {})}>
        <Text size="caption" tone="warm-muted" style={styles.status}>
          {statusText}
        </Text>
        <Button
          density="coach"
          size="md"
          disabled={isPublishDisabled || onPublish === undefined}
          {...(onPublish ? { onPress: onPublish } : {})}
          accessibilityLabel={publishHint ? `Publish. ${publishHint}` : 'Publish'}
          testID="publish-program"
        >
          Publish
        </Button>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: ACTION_BAR_BOTTOM },
  bar: {
    marginHorizontal: spacing(12),
    borderRadius: radius.full,
    paddingLeft: spacing(16),
    paddingRight: spacing(9),
    paddingVertical: spacing(9),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(10),
  },
  status: { flex: 1, minWidth: 0 },
});
