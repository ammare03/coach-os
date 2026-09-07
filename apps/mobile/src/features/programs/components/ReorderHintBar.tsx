import { GlassSurface, radius, spacing, Text } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { ACTION_BAR_BOTTOM } from './BuilderActionBar.tsx';

// The action bar while a drag is live (`program-builder/03`, frame 1d).
//
// Frame 1d's decision is that the bar **swaps its button for a plain
// instruction line** mid-reorder: nothing else on the screen is tappable
// while a card is in the air, so nothing else is offered. The day screen has
// no Publish of its own (`BuilderActionBar` docks on the builder screen, one
// level up), so here the swap is between "no bar" and "this line" — same
// geometry, same tier-1 glass, same dock height, so a coach who arrives from
// the builder sees the bar they already know change its contents rather than
// a new object appear in a new place.
//
// Nothing inside is focusable: it is a status line, not a control, and a
// screen-reader user is being told what happened by
// `announceForAccessibility` in `DraggableExerciseList` instead.

export interface ReorderHintBarProps {
  testID?: string;
}

export function ReorderHintBar({ testID }: ReorderHintBarProps) {
  return (
    <View style={styles.dock} pointerEvents="none">
      <GlassSurface tier="tier1" style={styles.bar} {...(testID ? { testID } : {})}>
        <Text size="caption" tone="warm-muted" style={styles.status}>
          Release to save the new order
        </Text>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: ACTION_BAR_BOTTOM },
  bar: {
    marginHorizontal: spacing(12),
    borderRadius: radius.full,
    paddingHorizontal: spacing(16),
    paddingVertical: spacing(9),
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
  },
  status: { flex: 1, minWidth: 0 },
});
