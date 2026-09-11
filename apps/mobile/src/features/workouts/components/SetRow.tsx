import { Metric, Pressable } from '@coachos/ui';
import {
  createThemedStyles,
  duration as durationTokens,
  easing,
  spacing,
  tapTarget,
  useReducedMotion,
  useTheme,
} from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect } from 'react';
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
import { SET_ENTRY_COPY, speakLoad, toDisplayWeight } from './SetEntryRow.tsx';
import { SET_FLAG_COPY } from './SetFlagChips.tsx';

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

/**
 * `centeredHitSlop(40, tapTarget.MIN)`'s arithmetic, restated because that
 * helper is internal to `packages/ui` and not exported from its theme barrel.
 * The row reaches 44pt by slop, never by growing its box — four rows have to
 * fit a 60px list.
 */
const ROW_HIT_SLOP = Math.ceil((tapTarget.MIN - SET_ROW_MIN_HEIGHT) / 2);

const TICK_SIZE = 15;

/**
 * The three channels a warm-up is de-emphasised on, **none of them hue**.
 *
 * Resolved in one place rather than spelled out across three JSX attributes,
 * because "three channels" is the rule and a rule split across three
 * expressions is a rule that loses one of them in a later edit. Desaturating
 * the design's frame J is the check it exists to pass (`accessibility` §4):
 * strip colour and the `W` still says warm-up.
 */
export interface SetRowInk {
  /** Channel 1. `W`, not a numeral — a warm-up occupies no set number. */
  glyph: string;
  numberTone: 'warm' | 'muted';
  /** Channel 2. The load, one step down from a working set's ink. */
  loadTone: 'default' | 'muted';
  /** Channel 3. The tick — muted, never absent: a warm-up is logged work. */
  tick: 'brand' | 'muted';
}

export function setRowInk(set: Pick<LoggedSetView, 'isWarmup' | 'setNumber'>): SetRowInk {
  if (set.isWarmup) {
    return {
      glyph: SET_FLAG_COPY.warmupGlyph,
      numberTone: 'muted',
      loadTone: 'muted',
      tick: 'muted',
    };
  }
  return {
    glyph: String(set.setNumber),
    numberTone: 'warm',
    loadTone: 'default',
    tick: 'brand',
  };
}

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
  /**
   * `local_set_logs.is_failure` (`set-entry/04`). Optional because a caller
   * seeding rows from a read that predates the column has nothing to put
   * here; absent means `false`, exactly as the mirror's own default does.
   *
   * The row draws nothing from it directly — the `to failure` tag arrives
   * through `trailing`, whose priority `SetFlagChips.renderSetTrailing`
   * resolves — but it travels with the set so that resolution has one input.
   */
  isFailure?: boolean;
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
   * **What `trailing` says out loud**, appended to this row's one label.
   *
   * The row is a single accessible element, so an occupant of the slot is
   * merged into it and silent unless its words arrive here — and that is
   * the wanted shape: a separately focusable line beside every logged set
   * would put a second stop between the client and the confirm
   * (`accessibility` §2).
   */
  trailingLabel?: string | undefined;
  /**
   * True for the row that just landed, and only for it. Read once, at
   * mount: a re-render must never replay the entrance.
   */
  isEntering?: boolean;
  /**
   * **`set-entry/05` — tap this row to correct it.** Supplied, the row is a
   * button and carries the `Double tap to edit` hint; omitted, it is the
   * plain receipt it has always been.
   *
   * Omitted is also what the caller passes **while another row is being
   * edited** (design frame F drops the hint from every other row then): one
   * editor at a time, and no row offering an affordance that would discard
   * the open edit.
   *
   * Takes the set rather than closing over it, so `SetList` can hand down
   * one stable callback for every row — a per-row arrow would allocate a new
   * `onEdit` each render and defeat this component's memo for twelve rows,
   * mid-set (`frontend-performance` §3).
   */
  onEdit?: ((set: LoggedSetView) => void) | undefined;
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
  trailingLabel,
  isEntering = false,
  onEdit,
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
  const ink = setRowInk(set);
  const label = speakSet(set, unit, trailingLabel);

  const handlePress = useCallback(() => {
    onEdit?.(set);
  }, [onEdit, set]);

  const content = (
    <>
      <View style={styles.number}>
        <Metric value={ink.glyph} size="numeral" tone={ink.numberTone} />
      </View>

      {/* No `numberOfLines`: at 200% text the load wraps and the row grows
          (`accessibility` §3). */}
      <Metric value={load} size="numeral" tone={ink.loadTone} />

      <View style={styles.gap} />

      {trailing}

      <Animated.View style={tickStyle}>
        <Check
          size={TICK_SIZE}
          color={ink.tick === 'brand' ? theme.colors.brand.DEFAULT : theme.colors.fg.muted}
          strokeWidth={2.8}
          // The row is one accessible element; the label already says "logged".
        />
      </Animated.View>
    </>
  );

  // The entrance lives on the outer view and the box on the inner one, so
  // the row can become a control without the animation having to know.
  return (
    <Animated.View style={rowStyle} testID={testID}>
      {onEdit === undefined ? (
        // One item, not five fragments (`accessibility` §2). Not a button:
        // with nothing to do to it, claiming it is one would be a lie to a
        // screen reader — and that is exactly the state every other row is
        // in while one of them is open for editing.
        <View style={[styles.row, themed.row]} accessible accessibilityLabel={label}>
          {content}
        </View>
      ) : (
        // 44pt by slop, never by growing the box. The hint is the visible
        // equivalent of the gesture, spoken.
        <Pressable
          onPress={handlePress}
          style={[styles.row, themed.row]}
          hitSlop={ROW_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={SET_ENTRY_COPY.editHint}
        >
          {content}
        </Pressable>
      )}
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

/**
 * `Set 3, 82.5 kilograms for 8 reps, logged.` — glyphs expanded to words,
 * plus whatever the trailing slot has to say: `… logged. Last time 80
 * kilograms for 8 reps.`
 *
 * A warm-up says what it is instead of a number, which is the spoken half of
 * the `W` in the number cell: reading "Set 3" for a row the client can see
 * is unnumbered would put the screen reader and the screen at odds.
 */
function speakSet(set: LoggedSetView, unit: WeightUnit, trailingLabel?: string): string {
  const load = speakLoad(toDisplayWeight(set.weightKg, unit), set.reps, unit);
  const name = set.isWarmup ? SET_FLAG_COPY.warmupSetLabel : `Set ${String(set.setNumber)}`;
  const sentence = `${name}, ${load}, logged.`;
  return trailingLabel === undefined ? sentence : `${sentence} ${trailingLabel}`;
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
