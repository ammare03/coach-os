import { Button, Text } from '@coachos/ui';
import { radius, spacing, useTheme } from '@coachos/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { SET_ENTRY_COPY, cancelEditingLabel, editingLabel } from './SetEntryRow.tsx';

// `set-entry/05` — what the pinned composer becomes while a logged set is
// being corrected.
//
// **Why the composer collapses at all.** The editor is the same card, in the
// list, over the row it is correcting — because loading a logged set into the
// pinned card would leave 21px of list and the client could not see the row
// they were editing (design spec, "Editing happens in the list"). Two cards
// stacked would leave less still, so the pinned one gives up its height and
// keeps only the thing that must stay reachable: **Cancel**.
//
// **44px, and it carries no confirm.** With no confirm pinned here, a new set
// cannot be logged while an edit is open — which is the whole reason the
// question "what if they log a set mid-edit" has no answer to design. It also
// means exactly one `SetEntryRow` is mounted at a time.
//
// **This is not a `Card`.** `Card`'s padding is uniform and its smallest
// density is 14px, which would put this bar at 60px and take 16px of list
// back off the client. The L2 recipe below is the theme's own
// `elevation.raised` — the same gradient, border and hairline `Card` draws —
// at this bar's own padding. No colour is invented here.

/** The hairline top highlight `elevation.raised` puts on every L2 surface. */
const HIGHLIGHT_HEIGHT = 1;

export interface EditingBarProps {
  /** The set being corrected. A warm-up is never numbered and says so instead. */
  setNumber: number;
  isWarmup: boolean;
  onCancel: () => void;
  testID?: string;
}

/**
 * The collapsed composer: the set under edit, named, and the way out of it.
 *
 * `accessible={false}` on the container — the label is a line of text and the
 * Cancel is a button, and merging them would make the button's name the whole
 * bar (`accessibility` §2, and the same rule the composer card follows).
 */
export function EditingBar({ setNumber, isWarmup, onCancel, testID }: EditingBarProps) {
  const { elevation } = useTheme();
  const raised = elevation.raised;

  return (
    <View
      style={[
        styles.bar,
        { borderWidth: raised.borderWidth, borderColor: raised.borderColor },
        raised.shadow,
      ]}
      accessible={false}
      testID={testID}
    >
      <LinearGradient
        colors={raised.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={[styles.topHighlight, { backgroundColor: raised.highlight }]}
      />

      {/* Not `numberOfLines` — at 200% text this wraps and the bar grows
          (`accessibility` §3). */}
      <Text size="body-sm" tone="warm" style={styles.label} testID="editing-bar-label">
        {editingLabel(setNumber, isWarmup)}
      </Text>

      {/* `size="sm"` reaches 44pt through the `Button`'s own `hitSlop`, not
          by growing the box — which is what keeps the bar at 44. */}
      <Button
        size="sm"
        variant="secondary"
        onPress={onCancel}
        accessibilityLabel={cancelEditingLabel(setNumber, isWarmup)}
        testID="editing-bar-cancel"
      >
        {SET_ENTRY_COPY.cancelEdit}
      </Button>
    </View>
  );
}

/** The bar's minimum box — the design's 44px, and what it may never fall below. */
export const EDITING_BAR_MIN_HEIGHT = 44;

const styles = StyleSheet.create({
  bar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(10),
    // `minHeight`, never `height`.
    minHeight: EDITING_BAR_MIN_HEIGHT,
    paddingLeft: spacing(12),
    paddingRight: spacing(6),
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HIGHLIGHT_HEIGHT,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
});
