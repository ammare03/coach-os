/* eslint-disable react-hooks/immutability --
   A Reanimated `SharedValue` is a mutable box by design: assigning `.value`
   is the only way to drive the UI thread, and it is the whole reason a
   drag can track a finger without a React render. The React Compiler rule
   sees `heights.value = …` on a value that arrived as a prop or a hook
   dependency and cannot tell it apart from mutating a plain object, so it
   flags every worklet in this file. Nothing else here is mutated; if this
   file ever grows non-Reanimated state, narrow this to per-line disables. */
import {
  createThemedStyles,
  duration,
  easing,
  Pressable,
  radius,
  tapTarget,
  useTheme,
} from '@coachos/ui';
import { Equal } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useReducedMotion } from '../../../lib/useReducedMotion.ts';
import type { ProgramDayExercise } from '../api/programs.ts';
import { dropIndexFor, moveItem, ROW_GAP, rowShift, rowTop, slotTop } from '../drag-reorder.ts';

import { ExerciseBlock } from './ExerciseBlock.tsx';

// Drag-to-reorder for one day's exercise blocks (`program-builder/03`,
// frame 1d). The row itself is `ExerciseBlock`, unchanged — this file takes
// over the container, exactly as that component's own docblock says
// `program-builder/03` and `/04` would.
//
// **What runs where.** The pan gesture's `onStart`/`onUpdate`/`onEnd` are
// worklets, so the finger-follow, the drop resolution, the neighbours'
// shift, and the placeholder all recompute on the UI thread. Nothing
// crosses to JS per frame. The bridge is used exactly three times in a
// drag: once at `onStart` (to dim the screen and disable the scroll view),
// once at `onEnd` (to send the new order), and once when the settle
// animation finishes. `dropIndexFor` and friends carry `'worklet'` in
// `../drag-reorder.ts` for that reason — a plain import would be called on
// the JS thread and undo the whole arrangement.
//
// **Why not FlashList.** A day holds at most `PROGRAM_BOUNDS
// .maxExercisesPerDay` blocks and every one of them has to be measured for
// the drop arithmetic; recycling rows out from under a live drag buys
// nothing at this size and costs correctness (`ui-conventions` §6's rule is
// about 400-row histories).
//
// **Where `program-builder/04` plugs in.** The item-order model and the
// drop resolution live in `../drag-reorder.ts`, not in the gesture: 04
// constrains where a superset member may land by wrapping `dropIndexFor`,
// without reopening anything here.

/** `.blk.lift` — `scale(1.02)` (`ProgramBuilder.dc.html`, frame 1d). */
const LIFT_SCALE = 1.02;

/** `.blk.ghosted` — every row that is not moving drops to `.5`. */
const GHOST_OPACITY = 0.5;

/** `.handle` — 15px, inside a `tapTarget.MIN` box. */
const HANDLE_GLYPH = 15;

/**
 * How long the coach holds before the row lifts. Long-press activation,
 * rather than an immediate pan on the handle, is what keeps the gesture
 * from fighting the screen's own `ScrollView` — the scroll loses outright
 * once the long press wins, on both platforms and with no ref-passing.
 */
const DRAG_HOLD_MS = 220;

/**
 * `.blk.lift`'s `0 22px 44px -12px rgba(0,0,0,.85)`. Deliberately heavier
 * than `elevation.raised.shadow`: the lift is the one moment in this screen
 * where a card is genuinely off the page rather than on it (`DESIGN.md` §2).
 */
const LIFT_SHADOW = {
  shadowOpacity: 0.85,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 14 },
  elevation: 12,
} as const;

const RISE = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);
const FILL = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

// Stable references — a fresh array on every render re-renders every
// memoised row (`frontend-performance` §3). `increment` moves a block DOWN
// the list, because the value the role exposes is its position.
const MOVE_BOTH = [
  { name: 'decrement', label: 'Move up' },
  { name: 'increment', label: 'Move down' },
] as const;
const MOVE_DOWN_ONLY = [{ name: 'increment', label: 'Move down' }] as const;
const MOVE_UP_ONLY = [{ name: 'decrement', label: 'Move up' }] as const;
const MOVE_NEITHER = [] as const;

function actionsFor(index: number, count: number) {
  if (count < 2) return MOVE_NEITHER;
  if (index === 0) return MOVE_DOWN_ONLY;
  if (index === count - 1) return MOVE_UP_ONLY;
  return MOVE_BOTH;
}

export interface DraggableExerciseListProps {
  /** Already sorted by `order_index` — `programs.days.get` returns it that way. */
  blocks: readonly ProgramDayExercise[];
  onOpenBlock: (block: ProgramDayExercise) => void;
  /** The day's complete new order. Not called when the drop changes nothing. */
  onReorder: (orderedExerciseIds: string[]) => void;
  /** The screen disables its scroll view and shows the reorder hint on `true`. */
  onDragActiveChange?: ((isDragging: boolean) => void) | undefined;
  testID?: string;
}

export function DraggableExerciseList({
  blocks,
  onOpenBlock,
  onReorder,
  onDragActiveChange,
  testID,
}: DraggableExerciseListProps) {
  const themed = useThemedStyles();
  const reducedMotion = useReducedMotion();

  // `-1` is "nothing is being dragged" for both. They are the only state the
  // UI thread reads, which is why they are shared values and not React
  // state — a `useState` here would put a set-state on every frame of the
  // drag (`frontend-performance` §6).
  const activeIndex = useSharedValue(-1);
  const dropIndex = useSharedValue(-1);
  const translationY = useSharedValue(0);
  const heights = useSharedValue<number[]>([]);

  // Row heights vary with the number of set chips, the notes line, and the
  // OS text size, so they are measured rather than assumed.
  //
  // Keyed by BLOCK ID, not by position: a reorder moves the same rows to new
  // indices without changing any of their heights, and an index-keyed cache
  // would then hand the next drag the previous order's geometry. The shared
  // value the worklets read is derived from `blocks`, so it re-derives the
  // moment the order changes.
  const measured = useRef<Map<string, number>>(new Map());
  const publishHeights = useCallback(() => {
    heights.value = blocks.map((block) => measured.current.get(block.id) ?? 0);
  }, [blocks, heights]);

  useEffect(publishHeights, [publishHeights]);

  const handleMeasure = useCallback(
    (id: string, height: number) => {
      if (measured.current.get(id) === height) return;
      measured.current.set(id, height);
      publishHeights();
    },
    [publishHeights],
  );

  const announce = useCallback(
    (block: ProgramDayExercise, position: number) => {
      AccessibilityInfo.announceForAccessibility(
        `${block.exerciseName} moved to ${position + 1} of ${blocks.length}`,
      );
    },
    [blocks.length],
  );

  const commit = useCallback(
    (from: number, to: number) => {
      const ids = blocks.map((block) => block.id);
      const next = moveItem(ids, from, to);
      if (next === ids) return;
      onReorder([...next]);
      const moved = blocks[from];
      if (moved) announce(moved, to);
    },
    [blocks, onReorder, announce],
  );

  const handleDragStart = useCallback(() => {
    onDragActiveChange?.(true);
  }, [onDragActiveChange]);

  const handleDrop = useCallback(
    (from: number, to: number) => {
      onDragActiveChange?.(false);
      commit(from, to);
    },
    [commit, onDragActiveChange],
  );

  const placeholderStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;
    if (active < 0) return { opacity: 0, height: 0, transform: [{ translateY: 0 }] };
    return {
      opacity: 1,
      height: heights.value[active] ?? 0,
      transform: [
        {
          translateY: slotTop(heights.value, ROW_GAP, active, dropIndex.value),
        },
      ],
    };
  });

  return (
    <View style={styles.list} {...(testID ? { testID } : {})}>
      {/* The gap the lifted card left, drawn from the same `slotTop` the
          drop resolution uses so the dashed box and the landing position
          can never disagree. Behind every row, and inert. */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.placeholder, themed.placeholder, placeholderStyle]}
        testID="reorder-placeholder"
      />

      {blocks.map((block, index) => (
        <DraggableRow
          key={block.id}
          block={block}
          index={index}
          count={blocks.length}
          reducedMotion={reducedMotion}
          activeIndex={activeIndex}
          dropIndex={dropIndex}
          translationY={translationY}
          heights={heights}
          onMeasure={handleMeasure}
          onOpen={onOpenBlock}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onMove={commit}
        />
      ))}
    </View>
  );
}

interface DraggableRowProps {
  block: ProgramDayExercise;
  index: number;
  count: number;
  reducedMotion: boolean;
  activeIndex: SharedValue<number>;
  dropIndex: SharedValue<number>;
  translationY: SharedValue<number>;
  heights: SharedValue<number[]>;
  onMeasure: (id: string, height: number) => void;
  onOpen: (block: ProgramDayExercise) => void;
  onDragStart: () => void;
  onDrop: (from: number, to: number) => void;
  onMove: (from: number, to: number) => void;
}

const DraggableRow = memo(function DraggableRow({
  block,
  index,
  count,
  reducedMotion,
  activeIndex,
  dropIndex,
  translationY,
  heights,
  onMeasure,
  onOpen,
  onDragStart,
  onDrop,
  onMove,
}: DraggableRowProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  // `DESIGN.md` §5's 180-220ms state band for the shift, the ghosting and
  // the settle. Under Reduce Motion the state changes still happen — they
  // just happen at once, which is §13's rule, not "no feedback at all".
  const settleMs = reducedMotion ? 0 : duration.state;
  const timing = useMemo(() => ({ duration: settleMs, easing: FILL }), [settleMs]);
  const settle = useMemo(() => ({ duration: settleMs, easing: RISE }), [settleMs]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(DRAG_HOLD_MS)
        .onStart(() => {
          'worklet';
          activeIndex.value = index;
          dropIndex.value = index;
          translationY.value = 0;
          runOnJS(onDragStart)();
        })
        .onUpdate((event) => {
          'worklet';
          translationY.value = event.translationY;
          dropIndex.value = dropIndexFor(heights.value, ROW_GAP, index, event.translationY);
        })
        .onEnd(() => {
          'worklet';
          const landing =
            slotTop(heights.value, ROW_GAP, index, dropIndex.value) -
            rowTop(heights.value, ROW_GAP, index);
          const target = dropIndex.value;
          // The order is sent BEFORE the card finishes travelling, so the
          // optimistic rewrite is already in flight while it settles; the
          // shared values reset only once it has landed, or the row would
          // snap back to where it started for the frame between.
          runOnJS(onDrop)(index, target);
          translationY.value = withTiming(landing, settle, () => {
            'worklet';
            activeIndex.value = -1;
            dropIndex.value = -1;
            translationY.value = 0;
          });
        })
        .onFinalize((_event, success) => {
          'worklet';
          if (success) return;
          // Cancelled — a call came in, the app backgrounded, the gesture
          // lost. Put everything back rather than leaving a lifted card.
          activeIndex.value = -1;
          dropIndex.value = -1;
          translationY.value = 0;
        }),
    [index, activeIndex, dropIndex, translationY, heights, onDragStart, onDrop, settle],
  );

  const rowStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;
    if (active < 0) {
      return { opacity: 1, zIndex: 0, elevation: 0, transform: [{ translateY: 0 }, { scale: 1 }] };
    }
    if (active === index) {
      // `zIndex` alone lifts the row above its siblings on iOS; Android
      // needs `elevation` as well or a later sibling paints over it
      // (`DESIGN.md` §12's shadow row).
      return {
        opacity: 1,
        zIndex: 2,
        elevation: LIFT_SHADOW.elevation,
        transform: [{ translateY: translationY.value }, { scale: LIFT_SCALE }],
      };
    }
    return {
      opacity: withTiming(GHOST_OPACITY, timing),
      zIndex: 0,
      elevation: 0,
      transform: [
        {
          translateY: withTiming(
            rowShift(heights.value, ROW_GAP, active, dropIndex.value, index),
            timing,
          ),
        },
        { scale: 1 },
      ],
    };
  });

  // Two of the three channels frame 1d uses to say "moving" — the brand ring
  // and the shadow — as one overlay rather than as props on `ExerciseBlock`,
  // which stays closed. The third is the handle, below.
  const liftStyle = useAnimatedStyle(() => ({
    opacity: withTiming(activeIndex.value === index ? 1 : 0, timing),
  }));

  const handleStyle = useAnimatedStyle(() => ({
    opacity: activeIndex.value < 0 || activeIndex.value === index ? 1 : GHOST_OPACITY,
  }));

  // The third channel: the handle of the row being moved turns brand
  // (frame 1d). Two stacked glyphs cross-fading rather than an animated
  // `color` prop — a Lucide icon's stroke is not an animatable style, and
  // driving it from React state would re-render every row on the frame the
  // drag starts.
  const brandGlyphStyle = useAnimatedStyle(() => ({
    opacity: activeIndex.value === index ? 1 : 0,
  }));

  const handleAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const { actionName } = event.nativeEvent;
      if (actionName === 'decrement' && index > 0) onMove(index, index - 1);
      if (actionName === 'increment' && index < count - 1) onMove(index, index + 1);
    },
    [index, count, onMove],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onMeasure(block.id, event.nativeEvent.layout.height);
    },
    [block.id, onMeasure],
  );

  const open = useCallback(() => {
    onOpen(block);
  }, [onOpen, block]);

  return (
    <Animated.View onLayout={handleLayout} style={[styles.row, rowStyle]}>
      <ExerciseBlock block={block} onPress={open} testID={`exercise-block-${block.id}`} />

      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.lift, themed.lift, LIFT_SHADOW, liftStyle]}
      />

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.handle, handleStyle]}>
          {/* `adjustable` with the position as its value is the whole
              non-gesture path (`accessibility` §7 — never a gesture with no
              button equivalent). `NumberStepper` uses the same shape, and a
              VoiceOver/TalkBack user swipes up and down here to move the
              block rather than hunting for a drag they cannot perform. */}
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={`Position of ${block.exerciseName}`}
            accessibilityHint="Press and hold to drag"
            accessibilityValue={{
              min: 1,
              max: count,
              now: index + 1,
              text: `${index + 1} of ${count}`,
            }}
            accessibilityActions={actionsFor(index, count)}
            onAccessibilityAction={handleAction}
            // `containerStyle`, not `style`: the outer touchable is what
            // takes the touch, so `tapTarget.MIN` has to be ITS box and not
            // the animated inner view's (`Pressable`'s own contract).
            containerStyle={styles.handleInner}
            testID={`reorder-handle-${block.id}`}
          >
            <View style={styles.glyph}>
              <Equal size={HANDLE_GLYPH} strokeWidth={2} color={theme.colors.fg.subtle} />
              <Animated.View style={[styles.glyphOverlay, brandGlyphStyle]}>
                <Equal size={HANDLE_GLYPH} strokeWidth={2.4} color={theme.colors.brand.DEFAULT} />
              </Animated.View>
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  list: { gap: ROW_GAP },
  row: { position: 'relative' },
  placeholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  lift: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  // Sits over the card's own top-left, where frame 1d draws it: the card
  // carries `density.coach.cardPadding` (14) and `ExerciseBlock`'s header
  // row is 44 tall, which puts the glyph's centre at (22, 36).
  handle: { position: 'absolute', top: 14, left: 0, width: tapTarget.MIN, height: tapTarget.MIN },
  handleInner: {
    width: tapTarget.MIN,
    height: tapTarget.MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: HANDLE_GLYPH, height: HANDLE_GLYPH },
  glyphOverlay: { position: 'absolute', top: 0, left: 0 },
});

const useThemedStyles = createThemedStyles((t) => ({
  placeholder: { backgroundColor: t.colors.bg.inset, borderColor: t.colors.border.strong },
  // The brand ring, and the shadow's ink — the same colour `elevation
  // .raised.shadow` casts, only deeper and further (`.blk.lift`), so a
  // white-label scheme moves both together.
  lift: { borderColor: t.colors.brand.DEFAULT, shadowColor: t.elevation.raised.shadow.shadowColor },
}));
