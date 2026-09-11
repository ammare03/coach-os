/* eslint-disable react-hooks/immutability --
   A Reanimated `SharedValue` is a mutable box by design: assigning `.value`
   is the only way to drive the UI thread, and it is the whole reason a
   swipe can track a finger without a React render. The React Compiler rule
   sees `translateX.value = …` inside a worklet and cannot tell it apart
   from mutating a plain object, so it flags every handler in this file.
   Nothing else here is mutated. */
import { Metric, Text } from '@coachos/ui';
import {
  createThemedStyles,
  duration,
  easing,
  radius,
  spacing,
  useReducedMotion,
  withAlpha,
} from '@coachos/ui/theme';
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
   */
  renderPage?: (page: ExercisePage) => ReactNode;
}

export function ExercisePager({
  pages,
  currentIndex,
  onIndexChange,
  renderPage,
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

  // The shell already owns the no-prescription state (`LoggerNoPrescription`);
  // a pager with no pages must not draw an empty frame on top of it.
  if (pages.length === 0) return null;

  return (
    <View style={styles.pager} testID="exercise-pager">
      <ExerciseRail pages={pages} currentIndex={index} onSelect={onIndexChange} />

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
                content={
                  Math.abs(position - index) <= RENDER_WINDOW ? renderPage?.(page) : undefined
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
  content: ReactNode;
}

/**
 * One exercise's card: its badge, where it sits, its name, and whatever
 * `renderPage` puts under them.
 *
 * Memoised — a ten-exercise session mounts ten of these and a page turn
 * changes two (`frontend-performance` §3).
 */
const Page = memo(function Page({ page, width, isCurrent, content }: PageProps) {
  const themed = useThemedStyles();

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
              and the card grows rather than clipping (`accessibility` §3). */}
          <Text size="h2" accessibilityRole="header">
            {page.name}
          </Text>
        </View>
      </View>

      <View style={styles.content}>{content}</View>
    </View>
  );
});

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
  content: {
    flex: 1,
    minHeight: 0,
  },
});

const useThemedStyles = createThemedStyles(({ colors, elevation }) => ({
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
}));
