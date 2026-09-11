import { Pressable, Text } from '@coachos/ui';
import { createThemedStyles, spacing, tapTarget, useTheme } from '@coachos/ui/theme';
import { Plus } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { SET_ROW_MIN_HEIGHT } from './SetRow.tsx';

// `session-modifications/01` — the terminus of the receipt, and the whole of
// this task's user-facing surface.
//
// **`target_sets` is the coach's plan, not a ceiling, and the mechanism for
// going past it already exists.** `SetEntrySlot`'s composer never stops
// offering the next number — it is `max(working) + workingInFlight + 1` and
// nothing in it consults the prescription. What was missing is the thing
// that SAYS so: after set 3 of 3 the composer reads "Set 4" with nothing on
// screen telling a client that is an ordinary thing to log rather than a
// miscount. This row is that.
//
// So it is an affordance over an existing mechanism, never a second logging
// path (feature AC: "no separate UI"). It computes no set number, mounts no
// `SetEntryRow`, touches no draft, and fires no haptic — `Light` is a set
// logged, and pressing this logs nothing.
//
// **Always mounted**, at or past the plan, because a client may want to add
// a set INSTEAD of completing every planned one rather than only after.
// There is no state in which the next set is illegitimate, so there is no
// disabled state either.
//
// ==================== WHY IT IS 40px AND NOT 44 ========================
//
// It is the last child of a ~60px list. A 44px box would cost that list a
// whole row of the receipt, so the tap floor is bought the way `SetRow`
// buys it — with slop on the `Pressable`, never by growing the box. The
// arithmetic below is `SetRow`'s own, restated for the same reason it
// restates `centeredHitSlop`'s.
//
// **Dashed, where a logged row's hairline is solid.** Dashed is already the
// product's mark for "not yet" — `ExerciseRail` draws `state.notStarted`
// that way — so the row reads as the column's one still-empty slot rather
// than as a fourth set that exists. `fg.warm` and not the primary fill: the
// confirm disc stays the only filled target on this screen.

/** Every word this control says, and the only place it says them (`product-copy` §6). */
export const ADD_SET_COPY = {
  /** Visible. Not "Add another set" — "another" implies the plan is finished, and it need not be. */
  label: 'Add set',
  /** Spoken: the number, so it is unambiguous beside rows that also carry numbers. */
  addSetLabel: (setNumber: number) => `Add set ${String(setNumber)}`,
  /** A warm-up holds no set number, so it names itself instead — `SetEntryRow`'s substitution. */
  addWarmupLabel: 'Add warm-up set',
  /**
   * Announced on press. A control that appears to do nothing is the worst
   * outcome available to a screen-reader user, and the composer this hands
   * over to is below a scroll view they may never have reached.
   */
  readyAnnouncement: (setNumber: number, load: string) => `Set ${String(setNumber)} ready, ${load}`,
  readyWarmupAnnouncement: (load: string) => `Warm-up set ready, ${load}`,
} as const;

/** `Add set 4` · `Add warm-up set` — resolved once, so label and announcement cannot disagree. */
export function addSetLabel(setNumber: number, isWarmup: boolean): string {
  return isWarmup ? ADD_SET_COPY.addWarmupLabel : ADD_SET_COPY.addSetLabel(setNumber);
}

/** The same rule for what the press announces. */
export function addSetAnnouncement(setNumber: number, isWarmup: boolean, load: string): string {
  return isWarmup
    ? ADD_SET_COPY.readyWarmupAnnouncement(load)
    : ADD_SET_COPY.readyAnnouncement(setNumber, load);
}

/** `centeredHitSlop(40, tapTarget.MIN)`, restated — that helper is internal to `packages/ui`. */
const HIT_SLOP = Math.ceil((tapTarget.MIN - SET_ROW_MIN_HEIGHT) / 2);

const PLUS_SIZE = 15;

export interface AddSetButtonProps {
  /** The number the composer is currently offering. Read, never derived here. */
  setNumber: number;
  /** The composer's warm-up chip, only so the label matches what a confirm would log. */
  isWarmup?: boolean;
  onPress: () => void;
  testID?: string;
}

export function AddSetButton({ setNumber, isWarmup = false, onPress, testID }: AddSetButtonProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      // No hint: the label already says what pressing it does.
      accessibilityLabel={addSetLabel(setNumber, isWarmup)}
      containerStyle={styles.container}
      style={[styles.row, themed.row]}
      testID={testID}
    >
      <View style={styles.content}>
        <Plus size={PLUS_SIZE} color={theme.colors.fg.warm} strokeWidth={2.4} />
        <Text size="body-sm" tone="warm">
          {ADD_SET_COPY.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // The list is `justifyContent: 'flex-end'`; a footer that shrank would
    // let the rows above it push it off the bottom.
    flexShrink: 0,
  },
  row: {
    // `minHeight`, never `height` — the row grows with the type at 200%
    // instead of clipping the label.
    minHeight: SET_ROW_MIN_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing(4),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(7),
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.strong,
    borderStyle: 'dashed',
  },
}));
