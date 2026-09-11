import { Metric } from '@coachos/ui';
import {
  createThemedStyles,
  duration as durationTokens,
  easing,
  spacing,
  useReducedMotion,
  useTheme,
} from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { labelLastPerformance } from '../lib/target-line-copy.ts';

// This feature's copy and its spoken forms live in `SetEntryRow.tsx`, the
// way `SessionFinish.tsx` owns `FINISH_COPY` — one home per surface, so the
// composer and the row it produces can never word the same set differently.
import { speakLoad, toDisplayWeight } from './SetEntryRow.tsx';

// `set-entry/01` — one set the client has already logged, and the moment it
// arrives. The receipt half of the two-tap interaction: the composer below
// it is where a set is made, this is the proof it exists.
//
// **Not a card.** The page is L1 and the composer is L2; a third surface
// here would spend a level the ladder has allocated. A row is a hairline and
// two numerals, the same §9 list-row divider `TargetLine` closes itself
// with.
//
// **The tick is the same check, at the same x, as the confirm disc** the
// client just pressed. Press and receipt are spatially continuous, which is
// what pays for the confirm being an icon rather than a labelled bar.
//
// **Nothing here knows about the network.** No pending tint, no sync badge,
// no spinner: a client logging twelve sets in a basement sees twelve
// identical rows. Outbox state belongs to the session, never to a row.

/**
 * The row's minimum box. Grows with the type at 200%; never a fixed `height`.
 *
 * Deliberately below §13's `tapTarget.MIN` — the box is what keeps four rows
 * inside a 60px list. When task 05 makes the row pressable, the floor is
 * bought with slop on the `Pressable`, never by growing the box:
 * `Math.ceil((tapTarget.MIN - SET_ROW_MIN_HEIGHT) / 2)`, which is
 * `centeredHitSlop`'s arithmetic restated because that helper is internal to
 * `packages/ui` and not exported from its theme barrel.
 */
export const SET_ROW_MIN_HEIGHT = 40;

const TICK_SIZE = 15;

/** What one logged set looks like to this feature, after the local write. */
export interface LoggedSetView {
  /** `local_set_logs.client_local_id` — task 05 edits by it, task 06 deletes by it. */
  localId: string;
  setNumber: number;
  reps: number;
  /** Kilograms, always (`CLAUDE.md` §0). `null` is a bodyweight set. */
  weightKg: number | null;
  loggedAt: Date;
  isWarmup: boolean;
}

export interface SetRowProps {
  set: LoggedSetView;
  /** Display unit only — the row never converts, it hands `packages/utils` the kilograms. */
  unit: WeightUnit;
  /**
   * **The one trailing occupant** (design spec, "One slot, two occupants"):
   * a flag tag (`set-entry/04`) or this set's previous performance
   * (`set-entry/03`), never both, and nothing is the absent state. 270px
   * will not carry two, and whoever passes this resolves the priority.
   */
  trailing?: ReactNode;
  /**
   * True for the row that just landed, and only for it. Read once, at
   * mount: a re-render must never replay the entrance.
   */
  isEntering?: boolean;
  testID?: string;
}

/**
 * Memoised: a twelve-set exercise re-renders this list on every keystroke of
 * the stepper above it, and a row's props change only when its own set does
 * (`frontend-performance` §3).
 */
export const SetRow = memo(function SetRow({
  set,
  unit,
  trailing,
  isEntering = false,
  testID,
}: SetRowProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();

  const animates = isEntering;
  // Seeded at the end state for every row that was already there, so
  // reopening a session mid-workout does not replay twelve entrances.
  const enter = useSharedValue(animates ? 0 : 1);
  const tick = useSharedValue(animates ? 0 : 1);

  useEffect(() => {
    if (!animates) return;
    // Reduced motion keeps the state change and drops the travel
    // (`accessibility` §6): opacity only, and the shorter 120ms, because
    // there is no distance left to cover.
    const ms = reducedMotion ? durationTokens.press : durationTokens.state;
    enter.value = withTiming(1, { duration: ms, easing: RISE });
    tick.value = withTiming(1, { duration: ms, easing: reducedMotion ? RISE : CELL_POP });
    // Mount-only: `animates` is fixed for this row's lifetime and the
    // shared values are refs, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: reducedMotion ? 0 : 8 * (1 - enter.value) }],
  }));

  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: reducedMotion ? 1 : 0.5 + 0.5 * tick.value }],
  }));

  const load = labelLoad(set, unit);

  return (
    <Animated.View
      style={[styles.row, themed.row, rowStyle]}
      // One item, not five fragments (`accessibility` §2). Task 05 adds the
      // `button` role, the "Double tap to edit" hint and task 06's delete
      // custom action here; until something can be done to a row, claiming
      // it is a button would be a lie to a screen reader.
      accessible
      accessibilityLabel={speakSet(set, unit)}
      testID={testID}
    >
      <View style={styles.number}>
        <Metric value={String(set.setNumber)} size="numeral" tone="warm" />
      </View>

      {/* No `numberOfLines`: at 200% text the load wraps and the row grows
          (`accessibility` §3). */}
      <Metric value={load} size="numeral" />

      <View style={styles.gap} />

      {trailing}

      <Animated.View style={tickStyle}>
        <Check
          size={TICK_SIZE}
          color={theme.colors.brand.DEFAULT}
          strokeWidth={2.8}
          // `accessible` above merges it in; the label already says "logged".
        />
      </Animated.View>
    </Animated.View>
  );
});

/** `82.5kg × 8`, or `8 reps` for a bodyweight set. */
function labelLoad(set: LoggedSetView, unit: WeightUnit): string {
  // The target line's own formatter, so a client's log is punctuated
  // exactly like the prescription above it and the unit is never a literal
  // (`product-copy` §6).
  return labelLastPerformance(
    { weightKg: set.weightKg, reps: set.reps, loggedAt: set.loggedAt },
    unit,
  );
}

/** `Set 3, 82.5 kilograms for 8 reps, logged.` — glyphs expanded to words. */
function speakSet(set: LoggedSetView, unit: WeightUnit): string {
  const load = speakLoad(toDisplayWeight(set.weightKg, unit), set.reps, unit);
  return `Set ${String(set.setNumber)}, ${load}, logged.`;
}

const RISE = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const CELL_POP = Easing.bezier(
  easing.cellPop[0],
  easing.cellPop[1],
  easing.cellPop[2],
  easing.cellPop[3],
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // `minHeight`, never `height` — the row grows with the type instead of
    // clipping it.
    minHeight: SET_ROW_MIN_HEIGHT,
    paddingHorizontal: spacing(4),
    gap: spacing(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  number: {
    width: 18,
  },
  gap: {
    flex: 1,
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  row: {
    // §9's list-row divider, the same hairline `TargetLine` closes with.
    borderBottomColor: colors.border.soft,
  },
}));
