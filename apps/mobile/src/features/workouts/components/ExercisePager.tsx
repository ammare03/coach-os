/* eslint-disable react-hooks/immutability --
   A Reanimated `SharedValue` is a mutable box by design: assigning `.value`
   is the only way to drive the UI thread, and it is the whole reason a
   swipe can track a finger without a React render. The React Compiler rule
   sees `translateX.value = …` inside a worklet and cannot tell it apart
   from mutating a plain object, so it flags every handler in this file.
   Nothing else here is mutated. */
import { Metric, Pressable, Text, useTheme } from '@coachos/ui';
import {
  createThemedStyles,
  duration,
  easing,
  radius,
  spacing,
  tapTarget,
  useReducedMotion,
  withAlpha,
} from '@coachos/ui/theme';
import { ArrowLeftRight, SkipForward } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { clampPageIndex, exercisePositionLine, type ExercisePage } from '../lib/exercise-pages.ts';
import {
  PAGE_GAP,
  pageOffset,
  pageStride,
  pageWidth,
  resistEdges,
  resolvePageIndex,
} from '../lib/pager-gesture.ts';
import { SKIP_REASON_LABEL, type SkippedExercise } from '../store/skipped-exercises-store.ts';

import { ExerciseRail } from './ExerciseRail.tsx';

// §8.4's "one exercise at a time, swipe or tap to move" — the container
// `session-runtime/04`'s target line and every `set-entry` surface render
// inside (`exercise-pager.html`, task 03's design).
//
// **This supersedes the vertical plan list in `DESIGN.md` §11 and
// `CoachOS-Client.dc.html`**, which predate the P09 decomposition. Horizontal
// paging is the decision; do not port it back to the prototype's list.
//
// **Controlled, deliberately.** The index is a prop and every change goes
// out through `onIndexChange`; this component holds no position state of
// its own beyond the animated offset. The position has to survive an app
// kill (`session-runtime/06`), which means it has to live in local SQLite,
// which means a component that owned it would be the one place the recovery
// path cannot see. `hooks/useExercisePosition.ts` owns it and writes it.
//
// **What runs where.** The pan's `onBegin`/`onUpdate`/`onEnd` are worklets,
// so the finger-follow, the edge resistance and the settle all recompute on
// the UI thread — the feature's own criterion is "Reanimated-driven, no
// JS-thread jank" and §19's floor is ≥55fps on a mid-range Android. The
// bridge is crossed exactly once per gesture, at `onEnd`, to report the new
// index. The arithmetic lives in `../lib/pager-gesture.ts` and carries
// `'worklet'` for that reason; a plain import would be hopped back to JS
// and undo the arrangement.
//
// **Nothing gates the move.** There is no "finish this one first" — a
// client whose machine is occupied skips it, and a superset is two
// exercises alternated rather than one completed then the other. Both are
// ordinary, which is why the rail reaches any exercise directly.
//
// **`session-runtime/06` audited this file** for the position write being
// synchronous. It is not written here at all — see the note above — and the
// write itself is in `hooks/useExercisePosition.ts`, un-debounced and
// un-batched, with a comment saying so. Confirmed: nothing on this path
// batches, debounces, or holds a page turn in memory.
//
// That audit did leave one thing load-bearing here. `clampPageIndex` on the
// `currentIndex` prop below is now the LAST clamp a restored position gets,
// and it is the one that runs against a live `pages.length`. The hook
// deliberately no longer clamps at restore time: the count is `0` while the
// session read is still in flight, and clamping against it sent every
// recovered position to the first exercise. Removing the clamp below would
// put that bug back, one layer down.

// §5 defines five durations and seven curves and NO spring, so the settle is
// a timing on the state band with the fill curve — §5 assigns `fill` to
// "fills, progress, sliding pill", and a page track settling to its stop is
// a sliding pill. `DraggableExerciseList` settles a released drag the same
// way, for the same reason.
//
// Deliberately not `withSpring`: every spring worth having here overshoots,
// and §5 reserves the only overshoot in the product for the PR moment
// (`easing.celebrate`). A page that bounces past the exercise and comes
// back would spend that moment on ordinary navigation.
const FILL = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/** How many pages either side of the current one mount their content. */
const RENDER_WINDOW = 1;

/** The skip icon, at the page head and on the skipped panel. */
const SKIP_ICON = 15;
const SKIP_MARK = 26;
/** The head pill's visible height. Compact so it sits beside a wrapping name. */
const SKIP_ACTION_HEIGHT = 36;
/**
 * `centeredHitSlop(36, tapTarget.MIN)`'s arithmetic, restated because that
 * helper is internal to `packages/ui` — the same restatement `SetRow` and
 * `AddSetButton` carry, and for the same reason.
 */
const SKIP_HIT_SLOP = (tapTarget.MIN - SKIP_ACTION_HEIGHT) / 2;

/**
 * Every word the skip affordance says on a page, and the only place it says
 * them — `SkipExerciseSheet`'s `SKIP_SHEET_COPY` is its sibling and owns the
 * sheet's own sentences.
 */
export const SKIP_PAGE_COPY = {
  /** Short enough to sit beside a wrapping exercise name. */
  action: 'Skip',
  /** The spoken name — a control's label says what it does to what (`accessibility` §2). */
  actionSpoken: 'Skip this exercise',
  /** The fact, never "missed" and never a count (`COPY.md` §CO3). */
  tag: 'Skipped',
  undo: 'Undo skip',
} as const;

/**
 * The swap affordance's words (`session-modifications/02`), sibling to
 * `SKIP_PAGE_COPY` above and deliberately its twin: both live in the same
 * page head, so they are worded to the same length and the same register.
 */
export const SWAP_PAGE_COPY = {
  action: 'Swap',
  actionSpoken: 'Swap this exercise',
  /** Said once, under the name it replaced. A fact, never a deviation. */
  swappedFor: (originalName: string) => `Instead of ${originalName}`,
  /** The spoken form of the same line, and what the page-head pill adds when it is in force. */
  swappedSpoken: (substituteName: string, originalName: string) =>
    `${substituteName}, swapped in for ${originalName}`,
} as const;

export interface ExercisePagerProps {
  /** `lib/exercise-pages.ts`'s model, in `orderIndex` order. Empty renders nothing. */
  pages: readonly ExercisePage[];
  /** Clamped internally, so a restored position from a since-edited program is safe. */
  currentIndex: number;
  onIndexChange: (index: number) => void;
  /**
   * The set-entry surface for one exercise. Mounted for the current page
   * and its immediate neighbours only — a stepper, a weight rail and a
   * plate stack per page is the expensive thing on this screen
   * (`frontend-performance` §3).
   *
   * `isCurrent` is the page the client is actually looking at — the two
   * neighbours are mounted but off screen. Anything that may exist only
   * once on the screen (`personal-records/03`'s pill, which is a child of
   * the composer card and so cannot be hoisted out of the page) branches on
   * it rather than rendering three times.
   */
  renderPage?: (page: ExercisePage, isCurrent: boolean) => ReactNode;
  /**
   * What the client explicitly skipped, by `ExercisePage.key`
   * (`session-modifications/03`). A skipped page replaces `renderPage`'s
   * content with its reason and a way back, and its rail stop takes a third
   * state distinct from both done and untouched.
   */
  skips?: ReadonlyMap<string, SkippedExercise> | undefined;
  /**
   * Opens the reason sheet for one page. **Absent, no skip affordance is
   * drawn at all** — so every caller that predates task 03 renders exactly
   * what it rendered before.
   */
  onSkipPress?: ((page: ExercisePage) => void) | undefined;
  /** Takes a skip back, from the skipped page itself. */
  onUndoSkip?: ((page: ExercisePage) => void) | undefined;
  /**
   * Opens the swap picker for one page (`session-modifications/02`).
   * **Absent, no swap affordance is drawn at all** — the same contract
   * `onSkipPress` carries, so a caller that predates this task renders
   * exactly what it rendered before.
   *
   * Never offered on a skipped page: there is nothing to log there, so
   * there is nothing to swap.
   */
  onSwapPress?: ((page: ExercisePage) => void) | undefined;
}

export function ExercisePager({
  pages,
  currentIndex,
  onIndexChange,
  renderPage,
  skips,
  onSkipPress,
  onUndoSkip,
  onSwapPress,
}: ExercisePagerProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const reducedMotion = useReducedMotion();

  const index = clampPageIndex(currentIndex, pages.length);
  const stride = pageStride(containerWidth);
  const width = pageWidth(containerWidth);

  const translateX = useSharedValue(0);
  const gestureStart = useSharedValue(0);
  // Read inside worklets, so they have to be shared values rather than
  // closed-over props — a worklet captures by value at creation.
  const indexValue = useSharedValue(index);
  const strideValue = useSharedValue(stride);
  const countValue = useSharedValue(pages.length);

  const announced = useRef<number | null>(null);

  // Under Reduce Motion the state change still happens — it just happens at
  // once, which is §13's rule rather than "no feedback at all".
  //
  // Memoised because the pan worklet closes over it: a fresh object every
  // render would re-serialise the gesture's captured config to the UI
  // thread for no change.
  const settle = useMemo(
    () => ({ duration: reducedMotion ? 0 : duration.state, easing: FILL }),
    [reducedMotion],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  // The one effect: keep the track, the worklet mirrors, and the screen
  // reader in step with the index — whether it changed by swipe, by tap, or
  // by kill-recovery restoring a position at mount.
  useEffect(() => {
    indexValue.value = index;
    strideValue.value = stride;
    countValue.value = pages.length;

    const target = pageOffset(index, stride);
    if (stride <= 0) {
      translateX.value = target;
    } else {
      translateX.value = withTiming(target, settle);
    }

    const page = pages[index];
    if (page && announced.current !== index) {
      announced.current = index;
      // A swipe is otherwise silent to a screen reader (`accessibility` §2).
      AccessibilityInfo.announceForAccessibility(exercisePositionLine(page));
    }
  }, [
    countValue,
    settle,
    index,
    indexValue,
    pages,
    reducedMotion,
    stride,
    strideValue,
    translateX,
  ]);

  const commit = useCallback(
    (next: number) => {
      if (next !== index) onIndexChange(next);
    },
    [index, onIndexChange],
  );

  const pan = Gesture.Pan()
    // Horizontal intent only: a vertical drag belongs to whatever scrolls
    // inside a page (a long list of set rows), and a 12pt threshold keeps a
    // thumb resting on the screen mid-set from moving anything.
    .activeOffsetX([-12, 12])
    .failOffsetY([-18, 18])
    .onBegin(() => {
      'worklet';
      gestureStart.value = translateX.value;
    })
    .onUpdate((event) => {
      'worklet';
      translateX.value = resistEdges(
        gestureStart.value + event.translationX,
        countValue.value,
        strideValue.value,
      );
    })
    .onEnd((event) => {
      'worklet';
      const next = resolvePageIndex({
        index: indexValue.value,
        translationX: event.translationX,
        velocityX: event.velocityX,
        stride: strideValue.value,
        count: countValue.value,
      });
      // Settle here rather than waiting for the effect: when the gesture
      // resolves back to the page it started on, `index` never changes and
      // no effect would run to spring the track home.
      translateX.value = withTiming(pageOffset(next, strideValue.value), settle);
      // The UI thread is authoritative the moment the gesture resolves. The
      // effect sets this too, but only after the bridge hop and a React
      // render — a second swipe starting inside that window would otherwise
      // resolve against the page the client has already left.
      indexValue.value = next;
      runOnJS(commit)(next);
    });

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Derived once rather than in each `Stop`: the rail's stops are memoised,
  // and a fresh `Set` per render would break every one of them.
  const skippedKeys = useMemo(
    () => (skips === undefined ? undefined : new Set(skips.keys())),
    [skips],
  );

  // The shell already owns the no-prescription state (`LoggerNoPrescription`);
  // a pager with no pages must not draw an empty frame on top of it.
  if (pages.length === 0) return null;

  return (
    <View style={styles.pager} testID="exercise-pager">
      <ExerciseRail
        pages={pages}
        currentIndex={index}
        onSelect={onIndexChange}
        skippedKeys={skippedKeys}
      />

      <GestureDetector gesture={pan}>
        <View style={styles.viewport} onLayout={handleLayout}>
          <Animated.View
            style={[
              styles.track,
              trackStyle,
              // One layout pass before the width is known; showing a
              // zero-width card for that frame would be a flash.
              { opacity: containerWidth > 0 ? 1 : 0 },
            ]}
          >
            {pages.map((page, position) => (
              <Page
                key={page.key}
                page={page}
                width={width}
                isCurrent={position === index}
                skip={skips?.get(page.key) ?? null}
                onSkipPress={onSkipPress}
                onUndoSkip={onUndoSkip}
                onSwapPress={onSwapPress}
                content={
                  Math.abs(position - index) <= RENDER_WINDOW
                    ? renderPage?.(page, position === index)
                    : undefined
                }
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

interface PageProps {
  page: ExercisePage;
  width: number;
  isCurrent: boolean;
  /** This page's skip, or `null`. Identity is stable between writes, so the memo holds. */
  skip: SkippedExercise | null;
  onSkipPress: ((page: ExercisePage) => void) | undefined;
  onUndoSkip: ((page: ExercisePage) => void) | undefined;
  onSwapPress: ((page: ExercisePage) => void) | undefined;
  content: ReactNode;
}

/**
 * One exercise's card: its badge, where it sits, its name, and whatever
 * `renderPage` puts under them.
 *
 * Memoised — a ten-exercise session mounts ten of these and a page turn
 * changes two (`frontend-performance` §3).
 */
const Page = memo(function Page({
  page,
  width,
  isCurrent,
  skip,
  onSkipPress,
  onUndoSkip,
  onSwapPress,
  content,
}: PageProps) {
  const themed = useThemedStyles();

  const handleSkipPress = useCallback(() => {
    onSkipPress?.(page);
  }, [onSkipPress, page]);

  const handleUndo = useCallback(() => {
    onUndoSkip?.(page);
  }, [onUndoSkip, page]);

  const handleSwapPress = useCallback(() => {
    onSwapPress?.(page);
  }, [onSwapPress, page]);

  const substitutedFor = page.substitutedFor;

  return (
    // L1, the recessed well (`DESIGN.md` §2) — a flat fill, a soft border,
    // and no drop. L2 is left free for the set rows `set-entry` mounts in
    // `content`: a raised card inside a raised card says nothing, and the
    // ladder only means anything while each level is used once.
    //
    // One view, not two: L1 has no shadow to keep clear of the clip, so the
    // outer wrapper an L2 card needs would be empty here.
    <View
      style={[styles.page, themed.page, { width }]}
      // Only the page in front of the client is in the reading order; the
      // 12pt peek of its neighbour is an affordance, not content.
      accessibilityElementsHidden={!isCurrent}
      importantForAccessibility={isCurrent ? 'yes' : 'no-hide-descendants'}
      testID={`exercise-page-${String(page.position - 1)}`}
    >
      <View style={styles.head}>
        {page.supersetGroup === null ? null : (
          <View style={[styles.badge, themed.badge]}>
            <Metric value={page.badge} size="micro" tone="warm" />
          </View>
        )}
        <View style={styles.words}>
          <Text size="eyebrow" tone="muted" style={styles.upper}>
            {exercisePositionLine(page)}
          </Text>
          {/* No `numberOfLines`: at 200% text a long exercise name wraps
              and the card grows rather than clipping (`accessibility` §3).
              On a swapped page this is the SUBSTITUTE's name — the page
              model folds the swap in, so nothing here has to know
              (`lib/exercise-pages.ts`). */}
          <Text
            size="h2"
            accessibilityRole="header"
            accessibilityLabel={
              substitutedFor === null
                ? undefined
                : SWAP_PAGE_COPY.swappedSpoken(page.name, substitutedFor.name)
            }
          >
            {page.name}
          </Text>
          {/* `session-modifications/02`. Said once, quietly, under the name
              it replaced — and hidden from the reading order because the
              header above already carries the same sentence in one piece. */}
          {substitutedFor === null ? null : (
            <View
              style={styles.swappedFrom}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="page-swapped-from"
            >
              <SwappedGlyph />
              <Text size="body-sm" tone="warm" style={styles.swappedWords}>
                {SWAP_PAGE_COPY.swappedFor(substitutedFor.name)}
              </Text>
            </View>
          )}
        </View>
        {/* In the HEAD, never in the content — `SetEntryRow`'s 205px is a
            binding invariant and nothing may make it conditional. The head
            already grows with a wrapping exercise name, so this costs the
            composer no coordinate. Present from the first frame: a skip must
            never require a logged set first (task 03's first criterion), and
            neither must a swap — a client whose rack is taken has not
            started.
            Task 02's affordance joins this one rather than opening a second,
            parallel surface. Both are absent on a skipped page: the composer
            is replaced there, so there is nothing to log and nothing to
            swap. */}
        {skip === null ? (
          <View style={styles.actions}>
            {onSwapPress === undefined ? null : (
              <SwapAction onPress={handleSwapPress} isInEffect={substitutedFor !== null} />
            )}
            {onSkipPress === undefined ? null : <SkipAction onPress={handleSkipPress} />}
          </View>
        ) : (
          <SkippedTag />
        )}
      </View>

      <View style={styles.content}>
        {skip === null ? (
          content
        ) : (
          // The composer is REPLACED, not covered: there is nothing to log
          // on a skipped exercise, and leaving a live stepper behind a
          // notice is how a client logs a set against something they said
          // they were not doing.
          <SkippedPanel skip={skip} onUndo={onUndoSkip === undefined ? undefined : handleUndo} />
        )}
      </View>
    </View>
  );
});

/** The substitution mark beside the "instead of" line. Decorative — the line says it. */
function SwappedGlyph() {
  const { colors } = useTheme();
  return <ArrowLeftRight size={SKIP_ICON} color={colors.fg.warm} strokeWidth={2.4} />;
}

/**
 * `session-modifications/02`'s affordance, built to `SkipAction`'s shape so
 * the two read as one control group rather than two decisions.
 *
 * `isInEffect` takes the warm edge and the maroon tint — the same pairing
 * the picker's chosen row uses, and a second channel beside the "instead of"
 * line so the state does not rest on hue (`DESIGN.md` §8).
 */
function SwapAction({ onPress, isInEffect }: { onPress: () => void; isInEffect: boolean }) {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={SWAP_PAGE_COPY.actionSpoken}
      hitSlop={SKIP_HIT_SLOP}
      style={[styles.skipAction, themed.skipAction, isInEffect && themed.swapActionOn]}
      testID="swap-exercise-action"
    >
      <ArrowLeftRight
        size={SKIP_ICON}
        color={isInEffect ? colors.fg.warm : colors.fg.muted}
        strokeWidth={2.4}
      />
      {/* An icon never travels alone (`DESIGN.md` §13), and no
          `numberOfLines`: at 200% text the word wraps and the head deepens. */}
      <Text size="label" tone={isInEffect ? 'warm' : 'muted'}>
        {SWAP_PAGE_COPY.action}
      </Text>
    </Pressable>
  );
}

function SkipAction({ onPress }: { onPress: () => void }) {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={SKIP_PAGE_COPY.actionSpoken}
      // The visible pill is compact so it sits beside a wrapping name; the
      // 44pt floor is reached with symmetric slop, the way `Chip` reaches it.
      hitSlop={SKIP_HIT_SLOP}
      style={[styles.skipAction, themed.skipAction]}
      testID="skip-exercise-action"
    >
      <SkipForward size={SKIP_ICON} color={colors.fg.muted} strokeWidth={2.4} />
      {/* An icon never travels alone (`DESIGN.md` §13), and no
          `numberOfLines`: at 200% text the word wraps and the head deepens. */}
      <Text size="label" tone="muted">
        {SKIP_PAGE_COPY.action}
      </Text>
    </Pressable>
  );
}

/**
 * The head's skipped marker.
 *
 * Hidden from the reading order: the page's own `SkippedPanel` below states
 * the same fact in a sentence, and a screen reader hearing "skipped" twice
 * before the reason is noise (`accessibility` §2).
 */
function SkippedTag() {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <View
      style={[styles.skippedTag, themed.skippedTag]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="page-skipped-tag"
    >
      <SkipForward size={SKIP_ICON} color={colors.fg.faint} strokeWidth={2.4} />
      <Text size="caption" tone="faint" style={styles.upper}>
        {SKIP_PAGE_COPY.tag}
      </Text>
    </View>
  );
}

interface SkippedPanelProps {
  skip: SkippedExercise;
  onUndo: (() => void) | undefined;
}

/**
 * What a skipped exercise shows where its composer would be — the reason,
 * the client's own words, and the way back.
 *
 * The undo is what lets the reason sheet ask for no confirmation at all
 * (`ui-conventions` §5's undo-not-confirm): a mis-tap costs two taps to
 * reverse, where a confirm would cost every honest skip an extra one.
 */
function SkippedPanel({ skip, onUndo }: SkippedPanelProps) {
  const themed = useThemedStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.skippedPanel} testID="page-skipped-panel">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SkipForward size={SKIP_MARK} color={colors.fg.faint} strokeWidth={2} />
      </View>
      <Text size="body-lg" style={styles.centred}>
        {SKIP_REASON_LABEL[skip.reason]}
      </Text>
      {skip.note === null ? null : (
        <Text size="body-sm" tone="muted" style={styles.centred}>
          {skip.note}
        </Text>
      )}
      {onUndo === undefined ? null : (
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={SKIP_PAGE_COPY.undo}
          style={[styles.undo, themed.undo]}
          testID="undo-skip-action"
        >
          <Text size="body-sm" tone="warm">
            {SKIP_PAGE_COPY.undo}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pager: {
    flex: 1,
    minHeight: 0,
  },
  viewport: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: PAGE_GAP,
  },
  page: {
    borderRadius: radius.section,
    padding: spacing(16),
    gap: spacing(12),
    // Still clips, though nothing of the page's own overflows any more:
    // `content` is `set-entry`'s surface, and it must not spill past the
    // rounded corner.
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(10),
  },
  badge: {
    minWidth: spacing(32),
    paddingHorizontal: spacing(8),
    paddingVertical: spacing(4),
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: {
    flex: 1,
    minWidth: 0,
    gap: spacing(5),
  },
  upper: {
    textTransform: 'uppercase',
  },
  swappedFrom: {
    flexDirection: 'row',
    alignItems: 'center',
    // No margin: the `words` column's own gap already separates it.
    gap: spacing(6),
  },
  swappedWords: {
    flex: 1,
    minWidth: 0,
  },
  // Both pills, `flexShrink: 0`, so the name column gives way and the head
  // deepens at 200% text rather than either control being clipped.
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(8),
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  skipAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(6),
    // `minHeight`, never `height` — at 200% text the word grows the pill.
    minHeight: SKIP_ACTION_HEIGHT,
    paddingHorizontal: spacing(12),
    paddingVertical: spacing(8),
    borderRadius: radius.full,
    borderWidth: 1,
    flexShrink: 0,
  },
  skippedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(6),
    paddingHorizontal: spacing(10),
    paddingVertical: spacing(6),
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexShrink: 0,
  },
  skippedPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
    paddingHorizontal: spacing(12),
    paddingVertical: spacing(20),
  },
  centred: {
    textAlign: 'center',
  },
  undo: {
    marginTop: spacing(6),
    minHeight: tapTarget.MIN,
    paddingHorizontal: spacing(18),
    paddingVertical: spacing(11),
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useThemedStyles = createThemedStyles(({ colors, control, elevation }) => ({
  page: {
    // L1's whole recipe — fill, border width, border colour — taken from
    // the token rather than restated, the way the other L1 surfaces in the
    // app take it.
    ...elevation.inset,
  },
  badge: {
    // Tinted maroon at low alpha with a dimmed brand edge — NOT solid
    // `deep` under a full-strength `brand.DEFAULT` border, which is §8's
    // record treatment and is reserved: "the only celebratory moment in the
    // product; do not reuse". `set-entry` will put a real PR badge on this
    // same screen, and the two have to stay tellable apart. Matches the
    // rail's own superset bracket, so the pair reads as one language.
    backgroundColor: withAlpha(colors.deep, '0.3'),
    borderColor: withAlpha(colors.brand.DEFAULT, '0.34'),
  },
  skipAction: {
    // A quiet secondary control on the L1 well — neutral, never `urgent`.
    // §8 reserves red for missed, overdue and destructive, and a client who
    // skips an exercise their gym cannot equip has done nothing destructive
    // (`COPY.md` §CO3).
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
  swapActionOn: {
    // The maroon tint under a dimmed brand edge — the picker's chosen row
    // and the rail's superset bracket use the same pairing. NOT §8's solid
    // record treatment, which stays reserved.
    backgroundColor: withAlpha(colors.deep, '0.3'),
    borderColor: colors.brand.shade,
  },
  skippedTag: {
    // The rail's skipped language, repeated on the page so the two surfaces
    // say the same thing the same way.
    borderColor: colors.fg.faint,
  },
  undo: {
    backgroundColor: control.surface,
    borderColor: colors.border.DEFAULT,
  },
}));
