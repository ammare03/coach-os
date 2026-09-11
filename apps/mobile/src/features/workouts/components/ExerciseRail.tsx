import { Metric, Pressable, useTheme } from '@coachos/ui';
import { createThemedStyles, radius, spacing, tapTarget, withAlpha } from '@coachos/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { memo, useCallback, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { exerciseStopLabel, type ExercisePage } from '../lib/exercise-pages.ts';

// The rail above the pages: the position indicator, and the tap half of
// §8.4's "swipe or tap to move" (`exercise-pager.html`, every frame).
//
// **Why a rail rather than a Next button.** `accessibility` §7 requires a
// visible control for anything a gesture does, and this is it — but it also
// does something a Next button cannot: it reaches ANY exercise in one tap,
// so `03`'s non-linear-navigation criterion is satisfied by the shape of the
// control rather than by an extra affordance beside it. A prev/next pair
// was drawn and dropped for duplicating it while offering strictly less.
//
// **A tablist, literally.** The stops select which page of content shows,
// which is what `tablist`/`tab` mean; the roles are not decoration. A
// screen reader then hears one item per exercise — name, place, superset,
// progress — rather than four fragments (`accessibility` §2).
//
// **The pill moves; the track never recolours** (`DESIGN.md` §4). It is the
// same selection pill the dock and the segmented control use, so a client
// already knows what it means. State never rides on hue alone (§8): done is
// a check, in progress is a filled meter, untouched is a dashed stub.

/**
 * §13's MID-SET floor (52), not the general 44 and not `ui-conventions` §5's
 * general client floor of 48: a rail stop is pressed between reps, with
 * chalked hands, by this file's own argument — which is exactly the case
 * `tapTarget.MID_SET` exists for.
 */
const STOP_SIZE = tapTarget.MID_SET;
const ICON = 13;
const METER_WIDTH = 20;
const METER_HEIGHT = 3;
/** The letter tile that leads a superset run — `program-builder`'s own gutter width. */
const LETTER_WIDTH = 22;
/** How much of the rail is kept visible to the left of the current stop when it scrolls. */
const SCROLL_LEAD = 64;

export interface ExerciseRailProps {
  pages: readonly ExercisePage[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function ExerciseRail({ pages, currentIndex, onSelect }: ExerciseRailProps) {
  const scroller = useRef<ScrollView>(null);
  // Stop offsets, filled by each stop's own `onLayout`. A ref rather than
  // state: they are read when the current index changes and never rendered,
  // so putting them in state would re-render the whole rail per stop.
  const offsets = useRef<number[]>([]);

  const handleStopLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      offsets.current[index] = event.nativeEvent.layout.x;
      // The first pass: the restored position may be off-screen before the
      // client has touched anything, and it has to be visible immediately.
      if (index === currentIndex) scrollToStop(scroller.current, event.nativeEvent.layout.x, false);
    },
    [currentIndex],
  );

  // Every later change — a swipe, or a tap on a stop near the edge — brings
  // the new current stop into view. Without this a ten-exercise session
  // pages past the end of the rail and the indicator silently leaves.
  useEffect(() => {
    const offset = offsets.current[currentIndex];
    if (offset !== undefined) scrollToStop(scroller.current, offset, true);
  }, [currentIndex]);

  // Runs of adjacent superset members are wrapped in one bracket, so the
  // pair reads as one object and alternating between them — which is what a
  // superset IS — is visibly one tap.
  const groups = groupIntoRuns(pages);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      // The rail is chrome, not the page: a horizontal drag on it scrolls
      // the rail and never reaches the pager's pan.
      contentContainerStyle={styles.railContent}
      style={styles.rail}
      accessibilityRole="tablist"
      testID="exercise-rail"
    >
      {groups.map((run) =>
        run.group === null ? (
          run.pages.map((page) => (
            <Stop
              key={page.key}
              page={page}
              index={page.position - 1}
              isCurrent={page.position - 1 === currentIndex}
              onSelect={onSelect}
              onStopLayout={handleStopLayout}
            />
          ))
        ) : (
          <SupersetRun
            key={`run-${run.group}-${String(run.pages[0]?.position ?? 0)}`}
            group={run.group}
            pages={run.pages}
            currentIndex={currentIndex}
            onSelect={onSelect}
            onStopLayout={handleStopLayout}
          />
        ),
      )}
    </ScrollView>
  );
}

function scrollToStop(view: ScrollView | null, x: number, animated: boolean): void {
  view?.scrollTo({ x: Math.max(x - SCROLL_LEAD, 0), animated });
}

interface Run {
  /** `null` for a standalone stretch; a letter for one run of adjacent members. */
  group: string | null;
  pages: ExercisePage[];
}

/**
 * Splits the pages into alternating standalone stretches and superset runs.
 *
 * A run is a stretch of ADJACENT members, which is why a group split by a
 * standalone block produces two brackets — the honest rendering of a
 * contradiction rather than a bracket drawn around something else.
 */
export function groupIntoRuns(pages: readonly ExercisePage[]): Run[] {
  const runs: Run[] = [];
  for (const page of pages) {
    const last = runs[runs.length - 1];
    if (last && last.group === page.supersetGroup && !(page.isRunStart && page.supersetGroup)) {
      last.pages.push(page);
      continue;
    }
    runs.push({ group: page.supersetGroup, pages: [page] });
  }
  return runs;
}

interface SupersetRunProps {
  group: string;
  pages: ExercisePage[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onStopLayout: (index: number, event: LayoutChangeEvent) => void;
}

function SupersetRun({ group, pages, currentIndex, onSelect, onStopLayout }: SupersetRunProps) {
  const themed = useThemedStyles();

  return (
    <View style={[styles.run, themed.run]}>
      {/* Decorative: the letter is already inside every member's own label
          and its badge, so announcing it again would repeat itself. */}
      <View
        style={styles.letter}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Metric value={group} size="micro" tone="warm" />
      </View>
      {pages.map((page) => (
        <Stop
          key={page.key}
          page={page}
          index={page.position - 1}
          isCurrent={page.position - 1 === currentIndex}
          onSelect={onSelect}
          onStopLayout={onStopLayout}
        />
      ))}
    </View>
  );
}

interface StopProps {
  page: ExercisePage;
  index: number;
  isCurrent: boolean;
  onSelect: (index: number) => void;
  onStopLayout: (index: number, event: LayoutChangeEvent) => void;
}

/**
 * One exercise on the rail.
 *
 * Memoised because a long session renders ten of these and only two change
 * on a page turn (`frontend-performance` §3). The handlers it closes over
 * take the index rather than being built per row, so the memo actually
 * holds.
 */
const Stop = memo(function Stop({ page, index, isCurrent, onSelect, onStopLayout }: StopProps) {
  const themed = useThemedStyles();
  const { colors, selectionPill } = useTheme();

  const handlePress = useCallback(() => {
    // Never fire for the page already showing: a no-op change would still
    // write a position and re-run the settle animation.
    if (!isCurrent) onSelect(index);
  }, [index, isCurrent, onSelect]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onStopLayout(index, event);
    },
    [index, onStopLayout],
  );

  return (
    <View
      onLayout={handleLayout}
      // §4's selection-pill drop shadow goes here, on the outer view:
      // `styles.stop` clips, and `overflow: 'hidden'` would eat it. Same
      // split, same reason, as `Chip`.
      style={isCurrent ? themed.selectedShadow : undefined}
      testID={`exercise-rail-stop-${String(index)}`}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="tab"
        accessibilityState={{ selected: isCurrent }}
        accessibilityLabel={exerciseStopLabel(page)}
        style={[
          styles.stop,
          themed.stop,
          // A finished stop carries a dimmed brand edge as well as its
          // check (`exercise-pager.html`, frames A and C). Not while it is
          // the current one — the pill owns that stop's edge.
          isComplete(page) && !isCurrent && themed.stopDone,
          isCurrent && themed.stopCurrent,
        ]}
      >
        {isCurrent ? (
          <>
            <LinearGradient
              colors={selectionPill.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.pill]}
            />
            {/* §12's faked inset top edge — without it the pill reads flat. */}
            <View
              pointerEvents="none"
              style={[styles.hairline, { backgroundColor: selectionPill.highlight }]}
            />
          </>
        ) : null}
        <Metric value={page.badge} size="numeral" tone={badgeTone(page, isCurrent)} />
        <ProgressChannel page={page} tint={colors} />
      </Pressable>
    </View>
  );
});

/** `bright` on the pill, `warm` once complete, `muted` otherwise — §1.1's ramp. */
function badgeTone(page: ExercisePage, isCurrent: boolean): 'bright' | 'warm' | 'muted' {
  if (isCurrent) return 'bright';
  return isComplete(page) ? 'warm' : 'muted';
}

function isComplete(page: ExercisePage): boolean {
  return page.setsLogged !== null && page.targetSets > 0 && page.setsLogged >= page.targetSets;
}

interface ProgressChannelProps {
  page: ExercisePage;
  tint: ReturnType<typeof useTheme>['colors'];
}

/**
 * The second, non-colour channel §8 requires — a check, a filled meter, or
 * a dashed stub.
 *
 * **Nothing at all when `setsLogged` is `null`.** Until `set-entry` ships
 * there are no set logs to count, and a dashed "nothing logged" stub on
 * every stop would be a claim rather than an absence.
 */
function ProgressChannel({ page, tint }: ProgressChannelProps) {
  const themed = useThemedStyles();

  if (page.setsLogged === null) return null;

  if (isComplete(page)) {
    // The testID sits on a wrapper rather than the icon: a Lucide glyph
    // renders an Svg that does not forward it to a host node, so the state
    // would be untestable on the icon itself (`DraggableExerciseList`, same).
    return (
      <View testID="stop-complete">
        <Check size={ICON} color={tint.brand.DEFAULT} strokeWidth={3} />
      </View>
    );
  }

  if (page.setsLogged === 0) {
    return <View style={[styles.dash, themed.dash]} testID="stop-untouched" />;
  }

  const fraction = page.targetSets > 0 ? Math.min(page.setsLogged / page.targetSets, 1) : 0;
  return (
    <View style={[styles.meter, themed.meter]} testID="stop-partial">
      {/* An absolute width, not a percentage: the meter is a fixed 20pt
          well, so the arithmetic is exact and needs no layout pass. */}
      <View
        style={[
          styles.meterFill,
          { backgroundColor: tint.brand.mid, width: METER_WIDTH * fraction },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexGrow: 0,
    flexShrink: 0,
  },
  railContent: {
    alignItems: 'stretch',
    gap: spacing(7),
    paddingBottom: spacing(12),
    paddingTop: spacing(3),
  },
  stop: {
    width: STOP_SIZE,
    // `minHeight`, never `height`: at 200% text the badge grows and the
    // rail deepens with it rather than clipping (`accessibility` §3).
    minHeight: STOP_SIZE,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(4),
    overflow: 'hidden',
  },
  pill: {
    borderRadius: radius.card,
  },
  hairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // A literal 1, not `StyleSheet.hairlineWidth`: every other consumer of
    // `selectionPill` uses 1, and at @3x a 0.33pt edge is faint enough that
    // §12's "without it the pill reads flat" happens anyway.
    height: 1,
  },
  run: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing(4),
    padding: spacing(3),
    borderRadius: radius.section,
    borderWidth: 1,
  },
  letter: {
    width: LETTER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meter: {
    width: METER_WIDTH,
    height: METER_HEIGHT,
    borderRadius: METER_HEIGHT / 2,
    overflow: 'hidden',
  },
  meterFill: {
    height: METER_HEIGHT,
    borderRadius: METER_HEIGHT / 2,
  },
  dash: {
    width: METER_WIDTH,
    borderTopWidth: 2,
    borderStyle: 'dashed',
  },
});

const useThemedStyles = createThemedStyles(({ colors, control, dataviz, selectionPill }) => ({
  stop: {
    backgroundColor: control.surface,
    borderColor: colors.border.strong,
  },
  stopDone: {
    borderColor: colors.brand.shade,
  },
  stopCurrent: {
    // The mockup keeps an edge on the current stop rather than dropping it
    // the way `Chip` does — a stop sits on the screen's own ground, not in
    // a segmented track, so without one the pill has nothing to end against.
    borderColor: withAlpha(colors.fg.glass, '0.34'),
  },
  selectedShadow: selectionPill.shadow,
  run: {
    backgroundColor: withAlpha(colors.deep, '0.3'),
    borderColor: withAlpha(colors.brand.DEFAULT, '0.34'),
  },
  meter: {
    // §7's own progress-bar well, rather than a hand-mixed alpha.
    backgroundColor: dataviz.barTrack,
  },
  dash: {
    // §1.1 says `fg.faint` "never carries meaning" — here the MEANING is
    // the dashed shape, and the hue is the same value §8 gives
    // `state.notStarted`, reached through the text token because the
    // `adherence-colors-only` rule reserves `colors.state.*` for adherence.
    borderColor: colors.fg.faint,
  },
}));
