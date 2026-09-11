import { Metric, Pressable, Text } from '@coachos/ui';
import {
  createThemedStyles,
  duration as durationTokens,
  easing,
  spacing,
  tapTarget,
  useReducedMotion,
  useTheme,
  withAlpha,
} from '@coachos/ui/theme';
import type { WeightUnit } from '@coachos/utils';
import { Check, Triangle } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type EntryExitAnimationFunction,
  type LayoutAnimationFunction,
} from 'react-native-reanimated';

import { PR_COPY } from '../lib/pr-celebration.ts';
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
 * **The mark the celebration leaves behind** (`personal-records/03`, design
 * frame C). The pill is gone in 2.6 seconds and a client re-racking a bar
 * will miss it; the row that earned the record keeps this for the rest of
 * the session, so finding out does not depend on having been looking.
 *
 * A triangle, not a colour: it differs by SHAPE before it differs by hue, so
 * it survives greyscale — the same rule the adherence palette is held to
 * (`accessibility` §4). 13px, against the tick's 15.
 */
const RECORD_MARK_SIZE = 13;

// ── `set-entry/06`, the swipe (design spec, "Anatomy — the compact logged
// row") ───────────────────────────────────────────────────────────────────
//
// Every number here is the design's, and each one is load-bearing for a
// different failure: the row must not steal the pager's horizontal swipe
// (`activeOffsetX`), must not fight the list's vertical scroll
// (`failOffsetY`), must commit on a flick as well as on distance, and must
// resist rather than stop dead at the end of its travel.

/** Horizontal slop before the pan claims the gesture, so a tap still edits. */
const SWIPE_ACTIVATE_X = 12;
/** Vertical slop that hands the gesture back to the list's scroll. */
const SWIPE_FAIL_Y = 18;
/** Past this fraction of the row's width, releasing deletes. */
const SWIPE_COMMIT_FRACTION = 0.4;
/** …or a flick faster than this, in px/s — 0.11px/ms, the design's number. */
const SWIPE_COMMIT_VELOCITY = 110;
/** Where the reveal panel is fully open. Past it the row rubber-bands. */
const SWIPE_REVEAL = 96;
/** `apple-design` §9 — resistance past the boundary, never a hard stop. */
const SWIPE_RESIST = 0.2;

/**
 * The further leftward travel the exit adds, on top of wherever the row
 * already is. A swipe leaves from where the finger let go rather than
 * snapping back to 0 first (`apple-design` §3 — animate from the
 * presentation value, never the target).
 */
const DELETE_EXIT_X = 24;

/**
 * **The non-gesture equivalent of the swipe, and it is required** — a swipe
 * is unreachable for many users (`accessibility` §7). VoiceOver and TalkBack
 * surface this in the rotor on the row itself; the editor's `Delete set`
 * button is the third entry point, and all three call one handler.
 */
const DELETE_ACTIONS = [{ name: 'delete', label: SET_ENTRY_COPY.deleteSet }] as const;

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
   * **This set took a personal record** (`personal-records/03`). Server-
   * confirmed, never guessed: the device cannot know it, and the mark
   * appears when the set syncs rather than when it is logged.
   *
   * Draws the triangle and adds "Personal record." to the row's one spoken
   * label. Nothing else about the row changes — it is still a receipt.
   */
  isRecord?: boolean;
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
  /**
   * **`set-entry/06` — withdraw this set.** Supplied, the row can be swiped
   * left and carries the `Delete set` custom action; omitted, neither
   * exists.
   *
   * Omitted is what the caller passes **while another row is being edited**,
   * for `onEdit`'s reason and one more: that row's own editor carries a
   * `Delete set` button, so a second way in from the list would let a stray
   * swipe withdraw a different set than the one on screen.
   *
   * Takes the set rather than closing over it, so one stable callback serves
   * every row (`frontend-performance` §3).
   */
  onDelete?: ((set: LoggedSetView) => void) | undefined;
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
  isRecord = false,
  onEdit,
  onDelete,
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
  const label = speakSet(set, unit, trailingLabel, isRecord);

  const handlePress = useCallback(() => {
    onEdit?.(set);
  }, [onEdit, set]);

  // ── the swipe, and the two ways in that are not a gesture ─────────────
  //
  // `swipe` is the row's own offset, and it is the ONLY owner of
  // `translateX`. The exit animation below reads it rather than declaring
  // its own start, so a row released at −92px keeps going left instead of
  // snapping back to 0 for one frame first.
  const swipe = useSharedValue(0);
  const rowWidth = useSharedValue(0);
  const canDelete = onDelete !== undefined;

  const handleDelete = useCallback(() => {
    onDelete?.(set);
  }, [onDelete, set]);

  const handleMeasure = useCallback(
    (event: LayoutChangeEvent) => {
      // The commit threshold is a fraction of the row, so it has to be the
      // rendered width — at 200% text the row is the same width and taller,
      // but a tablet or a split view is neither.
      rowWidth.value = event.nativeEvent.layout.width;
    },
    [rowWidth],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Off entirely rather than active-and-ignored: an enabled detector
        // still claims the gesture from the pager behind it.
        .enabled(canDelete)
        .activeOffsetX([-SWIPE_ACTIVATE_X, SWIPE_ACTIVATE_X])
        .failOffsetY([-SWIPE_FAIL_Y, SWIPE_FAIL_Y])
        .onUpdate((event) => {
          'worklet';
          // Leftward only. There is nothing under the right edge, and a row
          // that follows the finger toward an empty panel is a lie.
          const travel = Math.min(0, event.translationX);
          swipe.value =
            travel < -SWIPE_REVEAL
              ? -SWIPE_REVEAL + (travel + SWIPE_REVEAL) * SWIPE_RESIST
              : travel;
        })
        .onEnd((event) => {
          'worklet';
          const committed =
            -swipe.value >= rowWidth.value * SWIPE_COMMIT_FRACTION ||
            event.velocityX <= -SWIPE_COMMIT_VELOCITY;
          // Committed: leave the row where the finger left it and let the
          // exit carry it out. Not committed: back home, and the row is
          // exactly as it was.
          if (committed) {
            runOnJS(handleDelete)();
            return;
          }
          swipe.value = withTiming(0, {
            duration: reducedMotion ? 0 : durationTokens.state,
            easing: FILL,
          });
        }),
    [canDelete, handleDelete, reducedMotion, swipe, rowWidth],
  );

  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipe.value }],
  }));

  const revealStyle = useAnimatedStyle(() => ({
    // The panel is only there while the row is off it. Fully hidden at rest
    // so a stationary list carries no maroon band behind every row.
    opacity: swipe.value === 0 ? 0 : 1,
  }));

  /**
   * Design spec: `opacity 1→0` plus `translateX 0→−24`, `duration.press`
   * 120, `easing.out`. Reduced motion keeps the fade and drops the travel
   * (`accessibility` §6).
   *
   * A function rather than a builder so it can read `swipe` — see its
   * declaration. `easing.celebrate` is the PR moment's and appears nowhere
   * in this feature.
   */
  const exiting = useCallback<EntryExitAnimationFunction>(() => {
    'worklet';
    const from = swipe.value;
    const config = { duration: durationTokens.press, easing: OUT };
    return {
      initialValues: { opacity: 1, transform: [{ translateX: from }] },
      animations: {
        opacity: withTiming(0, config),
        transform: [
          { translateX: withTiming(reducedMotion ? from : from - DELETE_EXIT_X, config) },
        ],
      },
    };
  }, [swipe, reducedMotion]);

  /**
   * Design spec: the rows below close the gap over `duration.state` 200 at
   * `easing.fill`; reduced motion snaps at 0ms. Written out rather than
   * `LinearTransition.duration(…)` because this is the same four values that
   * builder produces, in the one form the repo's Reanimated test double can
   * also carry.
   */
  const layout = useCallback<LayoutAnimationFunction>(
    (values) => {
      'worklet';
      const config = { duration: reducedMotion ? 0 : durationTokens.state, easing: FILL };
      return {
        initialValues: {
          originX: values.currentOriginX,
          originY: values.currentOriginY,
          width: values.currentWidth,
          height: values.currentHeight,
        },
        animations: {
          originX: withTiming(values.targetOriginX, config),
          originY: withTiming(values.targetOriginY, config),
          width: withTiming(values.targetWidth, config),
          height: withTiming(values.targetHeight, config),
        },
      };
    },
    [reducedMotion],
  );

  const handleAccessibilityAction = useCallback(() => {
    // One custom action, so there is nothing to switch on — and `name` is
    // checked by the test rather than re-checked here.
    handleDelete();
  }, [handleDelete]);

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

      {/* Between the trailing slot and the tick, so the receipt still ends
          where every other row's does. Silent — the row is one accessible
          element and `label` already says it. */}
      {isRecord ? (
        // The `View` is what carries the `testID`: a Lucide icon spreads its
        // props onto `react-native-svg`, which does not forward one.
        <View testID="set-row-record-mark">
          <Triangle
            size={RECORD_MARK_SIZE}
            color={theme.colors.brand.DEFAULT}
            fill={withAlpha(theme.colors.brand.DEFAULT, '0.25')}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </View>
      ) : null}

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

  // Both ways in that a screen reader can reach: the row's own custom
  // action, and — when it is also a button — the edit hint it already had.
  // Spread rather than branched so the accessible element stays ONE element
  // either way (`accessibility` §2).
  const deleteProps = canDelete
    ? {
        accessibilityActions: DELETE_ACTIONS,
        onAccessibilityAction: handleAccessibilityAction,
      }
    : null;

  // The entrance lives on the outer view and the box on the inner one, so
  // the row can become a control without the animation having to know.
  return (
    <Animated.View style={rowStyle} exiting={exiting} layout={layout} testID={testID}>
      <View style={styles.swipe}>
        {/* Behind the row, revealed by it and never focusable: it is what
            the gesture uncovers, not a second control. Warm maroon at 14%
            because §8 reserves `urgent` for destructive — the one place in
            this feature it is correct. */}
        <Animated.View
          style={[styles.reveal, themed.reveal, revealStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text size="label" tone="urgent">
            {SET_ENTRY_COPY.swipeDelete}
          </Text>
        </Animated.View>

        <GestureDetector gesture={pan}>
          {/* Opaque, so the panel behind shows only where the row is not. */}
          <Animated.View style={[themed.surface, swipeStyle]} onLayout={handleMeasure}>
            {onEdit === undefined ? (
              // One item, not five fragments (`accessibility` §2). Not a
              // button: with nothing to do to it, claiming it is one would be
              // a lie to a screen reader — and that is exactly the state
              // every other row is in while one of them is open for editing.
              <View
                style={[styles.row, themed.row]}
                accessible
                accessibilityLabel={label}
                {...deleteProps}
              >
                {content}
              </View>
            ) : (
              // 44pt by slop, never by growing the box. The hint is the
              // visible equivalent of the gesture, spoken.
              <Pressable
                onPress={handlePress}
                style={[styles.row, themed.row]}
                hitSlop={ROW_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint={SET_ENTRY_COPY.editHint}
                {...deleteProps}
              >
                {content}
              </Pressable>
            )}
          </Animated.View>
        </GestureDetector>
      </View>
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
function speakSet(
  set: LoggedSetView,
  unit: WeightUnit,
  trailingLabel?: string,
  isRecord = false,
): string {
  const load = speakLoad(toDisplayWeight(set.weightKg, unit), set.reps, unit);
  const name = set.isWarmup ? SET_FLAG_COPY.warmupSetLabel : `Set ${String(set.setNumber)}`;
  const sentence = `${name}, ${load}, logged.`;
  const withTrailing = trailingLabel === undefined ? sentence : `${sentence} ${trailingLabel}`;
  // Last, so the fact a screen reader hears most recently is the one the
  // triangle is showing — and so a row with no record reads exactly as it
  // always has.
  return isRecord ? `${withTrailing} ${PR_COPY.title}.` : withTrailing;
}

const RISE = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const OUT = Easing.bezier(easing.out[0], easing.out[1], easing.out[2], easing.out[3]);
const FILL = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);
const CELL_POP = Easing.bezier(
  easing.cellPop[0],
  easing.cellPop[1],
  easing.cellPop[2],
  easing.cellPop[3],
);

const styles = StyleSheet.create({
  swipe: {
    // Clips the row to its own track, so a swiped row never draws over the
    // one above it.
    overflow: 'hidden',
  },
  reveal: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: spacing(14),
  },
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
  reveal: {
    // The design's panel is `urgent` at 14% over the page. `colors.urgent`
    // is reserved for adherence-state files (the `adherence-colors-only`
    // rule), and a reveal panel is not one — so it is reached through §1.1's
    // `deep`, the maroon that is NOT the adherence red, at the alpha that
    // composites to the same pixel over `bg.DEFAULT`: 0.35 of #541A2E gives
    // (44, 29, 47) against the design's (44, 29, 46).
    //
    // `ExerciseRail`'s dash makes the identical move for `state.notStarted`.
    // §8's real requirement is unaffected — the word **Delete** is the
    // second channel, so nothing here rests on hue.
    backgroundColor: withAlpha(colors.deep, '0.35'),
    borderBottomColor: colors.border.soft,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  surface: {
    // Opaque, and the page's own base — the row slides over the panel, it
    // does not become translucent against it.
    backgroundColor: colors.bg.DEFAULT,
  },
}));
