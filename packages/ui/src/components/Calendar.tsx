import type { CalendarDate } from '@coachos/utils';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import {
  colors,
  control,
  density as densityTokens,
  duration,
  easing,
  elevation,
  radius,
  selectionPill,
  stagger,
  tapTarget,
  type Density,
} from '../theme/tokens.ts';

import {
  addMonths,
  compareCalendarDates,
  endOfMonth,
  firstDayOfWeek,
  isWithinBounds,
  monthGrid,
  monthName,
  parseCalendarDate,
  spokenDate,
  startOfMonth,
  weekdayLabels,
  type CalendarCell,
  type WeekStart,
} from './calendar-grid.ts';
import { IconButton } from './IconButton.tsx';
import { Metric } from './Metric.tsx';
import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

/**
 * A dot under a day. `Calendar` knows nothing about adherence — the colour
 * is whatever the consumer passes (`AdherenceDot`'s ramp, a chart series, a
 * check-in state). `label` is not optional: a dot that only differs by hue
 * carries no meaning to a screen reader or to a colour-blind user, which
 * DESIGN.md §8 forbids ("never hue alone"), so the label is the second
 * channel and it is spoken as part of the day's accessibility label.
 */
export interface CalendarMarker {
  color: string;
  label: string;
}

/** `end` is `null` while a range is half-picked. */
export interface CalendarRange {
  start: CalendarDate;
  end: CalendarDate | null;
}

interface CalendarCommonProps {
  markers?: ReadonlyMap<CalendarDate, CalendarMarker>;
  minDate?: CalendarDate;
  maxDate?: CalendarDate;
  /**
   * The viewer's own local calendar day, as
   * `toLocalDate(new Date(), user.timezone)` from `@coachos/utils`. This
   * component never derives it: doing so would read the *device* timezone,
   * and a coach in Mumbai reviewing a client in Toronto would see the wrong
   * day ringed (`code-conventions` §6). Omit it and no day is marked today.
   */
  today?: CalendarDate;
  /** Which month opens. Defaults to the selection, then `today`, then `1970-01`. */
  initialMonth?: CalendarDate;
  /** Fires with the first of the new month, so a consumer can fetch that month's markers. */
  onVisibleMonthChange?: (month: CalendarDate) => void;
  /** BCP-47 tag. Omitted means the device locale — which is also what decides the first day of the week. */
  locale?: string;
  /** Overrides the locale's own first day of the week (`0` Sunday … `6` Saturday). */
  weekStartsOn?: WeekStart;
  density?: Density;
  testID?: string;
}

export type CalendarProps =
  | (CalendarCommonProps & {
      mode?: 'single';
      selected: CalendarDate | null;
      onSelect: (date: CalendarDate) => void;
    })
  | (CalendarCommonProps & {
      mode: 'range';
      selected: CalendarRange | null;
      onSelect: (range: CalendarRange) => void;
    });

// DESIGN.md §9's week strip, which is the only day cell the prototypes
// build: 58px tall / 7px gap / radius 14 in the client app
// (`CoachOS-Client.dc.html`), 48px tall / 5px gap / radius 12 in the coach
// app (`CoachOS-Coach.dc.html`). The radii resolve onto §1.4's ladder —
// 14 sits in the 14–16 "card" band, 12 is "control" exactly.
export const CALENDAR_CELL_GEOMETRY: Record<
  Density,
  { minHeight: number; gap: number; radius: number }
> = {
  client: { minHeight: 58, gap: 7, radius: radius.card },
  coach: { minHeight: 48, gap: 5, radius: radius.control },
};

// Seven columns cannot each be 48px wide on a phone, so the horizontal half
// of the tap target is reached the way every other primitive here reaches
// it — `hitSlop` into the gap, never by growing the cell (CONTRACT.md rule
// 3). Half the gap on each side, so adjacent days never overlap and a tap
// can never land on the wrong date. See `Calendar.test.tsx` for the
// arithmetic this has to satisfy at 375pt.
function columnHitSlop(gap: number) {
  const horizontal = gap / 2;
  return { top: 0, bottom: 0, left: horizontal, right: horizontal };
}

const MARKER_SIZE = 6;

const riseEasing = Easing.bezier(easing.rise[0], easing.rise[1], easing.rise[2], easing.rise[3]);

/**
 * Reduce Motion is a live setting, not a static capability — subscribed
 * rather than sampled once. Deliberately duplicated from
 * `SegmentedControl`: extracting it would edit a component this task has no
 * other business in (CLAUDE.md §0 rule 8). Promote it to
 * `theme/useReducedMotion.ts` on the third consumer.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value: boolean) => setReduced(value),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

type DayState = 'default' | 'selected' | 'inRange' | 'disabled';

/**
 * A month grid with single or range selection and a marker dot per day.
 *
 * **Every date crossing this component's boundary is a `"yyyy-MM-dd"`
 * string**, in and out — never a JS `Date`. A `Date` is an instant, and an
 * instant means a different calendar day either side of midnight, which is
 * the §25.5 hazard the rest of the product is built to avoid and the one a
 * date picker is most likely to reintroduce. The grid arithmetic lives in
 * `calendar-grid.ts` so it is testable without a renderer.
 *
 * The visible month is this component's own state — no screen needs to own
 * it — but `onVisibleMonthChange` fires on every move so a consumer can
 * fetch that month's markers.
 */
export function Calendar(props: CalendarProps) {
  const {
    markers,
    minDate,
    maxDate,
    today,
    initialMonth,
    onVisibleMonthChange,
    locale,
    weekStartsOn,
    density = 'client',
    testID,
  } = props;

  const seedMonth =
    initialMonth ??
    (props.mode === 'range' ? (props.selected?.start ?? null) : props.selected) ??
    today ??
    '1970-01-01';
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(seedMonth));

  const reducedMotion = useReducedMotion();
  const cell = CALENDAR_CELL_GEOMETRY[density];
  const resolvedWeekStart = weekStartsOn ?? firstDayOfWeek(locale);

  const weeks = useMemo(
    () => monthGrid(visibleMonth, resolvedWeekStart),
    [visibleMonth, resolvedWeekStart],
  );
  const weekdays = useMemo(
    () => weekdayLabels(resolvedWeekStart, locale),
    [resolvedWeekStart, locale],
  );

  function goToMonth(delta: number) {
    const next = startOfMonth(addMonths(visibleMonth, delta));
    setVisibleMonth(next);
    onVisibleMonthChange?.(next);
  }

  // A month is reachable if ANY of its days is — comparing its first day
  // against `minDate` would strand a `minDate` that falls mid-month.
  const canGoBack =
    minDate === undefined ||
    compareCalendarDates(endOfMonth(addMonths(visibleMonth, -1)), minDate) >= 0;
  const canGoForward =
    maxDate === undefined || compareCalendarDates(addMonths(visibleMonth, 1), maxDate) <= 0;

  function dayState(date: CalendarDate): DayState {
    if (!isWithinBounds(date, minDate, maxDate)) return 'disabled';
    if (props.mode === 'range') {
      const range = props.selected;
      if (!range) return 'default';
      if (date === range.start || date === range.end) return 'selected';
      if (
        range.end !== null &&
        compareCalendarDates(date, range.start) > 0 &&
        compareCalendarDates(date, range.end) < 0
      ) {
        return 'inRange';
      }
      return 'default';
    }
    return date === props.selected ? 'selected' : 'default';
  }

  function handlePress(date: CalendarDate) {
    if (props.mode === 'range') {
      const range = props.selected;
      // A completed range, or none at all, starts a new one. A half-picked
      // range completes — ordered low-to-high, so tapping an earlier day
      // second means "this is the other end", never "start over".
      if (!range || range.end !== null) {
        props.onSelect({ start: date, end: null });
        return;
      }
      props.onSelect(
        compareCalendarDates(date, range.start) < 0
          ? { start: date, end: range.start }
          : { start: range.start, end: date },
      );
      return;
    }
    props.onSelect(date);
  }

  return (
    <View testID={testID} style={{ gap: cell.gap }}>
      <View style={styles.header}>
        <IconButton
          icon={<ChevronLeft size={20} color={colors.fg.muted} />}
          size="md"
          onPress={() => goToMonth(-1)}
          disabled={!canGoBack}
          accessibilityLabel="Previous month"
          {...(testID === undefined ? {} : { testID: `${testID}-previous` })}
        />
        <View style={styles.headerLabel} accessibilityRole="header">
          <Text size="h2">{monthName(visibleMonth, locale)}</Text>
          <Metric value={parseCalendarDate(visibleMonth).year} size="h2" tone="muted" />
        </View>
        <IconButton
          icon={<ChevronRight size={20} color={colors.fg.muted} />}
          size="md"
          onPress={() => goToMonth(1)}
          disabled={!canGoForward}
          accessibilityLabel="Next month"
          {...(testID === undefined ? {} : { testID: `${testID}-next` })}
        />
      </View>

      <View style={[styles.row, { gap: cell.gap }]}>
        {weekdays.map((label, index) => (
          // The weekday header is decorative repetition for a screen
          // reader — each day already speaks its own full date.
          <View
            key={`${label}-${index}`}
            style={styles.column}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text size="eyebrow" tone="muted" numberOfLines={1} style={styles.weekdayLabel}>
              {label.toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, index) => (
        <WeekRow
          // Remounting on a month change is what replays the entrance.
          key={`${visibleMonth}-${index}`}
          index={index}
          reducedMotion={reducedMotion}
          gap={cell.gap}
        >
          {week.map((date, dayIndex) => (
            <DayCell
              key={date ?? `pad-${dayIndex}`}
              date={date}
              state={date === null ? 'default' : dayState(date)}
              isToday={date !== null && date === today}
              marker={date === null ? undefined : markers?.get(date)}
              locale={locale}
              cell={cell}
              onPress={handlePress}
            />
          ))}
        </WeekRow>
      ))}
    </View>
  );
}

interface WeekRowProps {
  index: number;
  reducedMotion: boolean;
  gap: number;
  children: ReactNode;
}

/**
 * DESIGN.md §5's `rowin` at `60ms` per row — the one stagger the motion
 * table sanctions for a grid of rows. Six animated views per month rather
 * than forty-two cells, which is what keeps a month change inside §19's
 * 55fps budget on a mid-range Android. Nothing here delays a tap: the row
 * is pressable from frame one.
 */
function WeekRow({ index, reducedMotion, gap, children }: WeekRowProps) {
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      index * stagger.matrixRow,
      withTiming(1, { duration: duration.enter, easing: riseEasing }),
    );
    // `progress` is a Reanimated shared value: stable identity, not a
    // reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: -14 * (1 - progress.value) }],
  }));

  return <Animated.View style={[styles.row, { gap }, animatedStyle]}>{children}</Animated.View>;
}

interface DayCellProps {
  date: CalendarCell;
  state: DayState;
  isToday: boolean;
  marker: CalendarMarker | undefined;
  locale: string | undefined;
  cell: { minHeight: number; gap: number; radius: number };
  onPress: (date: CalendarDate) => void;
}

function DayCell({ date, state, isToday, marker, locale, cell, onPress }: DayCellProps) {
  // A pad cell holds the column open and nothing else — never a dimmed,
  // tappable date from the neighbouring month (`calendar-grid.ts`).
  if (date === null) {
    return <View style={[styles.column, { minHeight: cell.minHeight }]} />;
  }

  const { day } = parseCalendarDate(date);
  const disabled = state === 'disabled';
  const selected = state === 'selected';

  const label = [
    spokenDate(date, locale),
    isToday ? 'today' : undefined,
    selected ? 'selected' : undefined,
    state === 'inRange' ? 'in selected range' : undefined,
    marker?.label,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={() => onPress(date)}
      disabled={disabled}
      hitSlop={columnHitSlop(cell.gap)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      containerStyle={styles.column}
      style={[
        styles.cell,
        {
          minHeight: cell.minHeight,
          borderRadius: cell.radius,
          gap: 3,
        },
        cellSurface(state, isToday),
      ]}
    >
      {selected ? (
        <>
          {/* DESIGN.md §4's selection pill — the same treatment `Chip` and
              `SegmentedControl` use for "this one is chosen". */}
          <LinearGradient
            colors={selectionPill.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View
            pointerEvents="none"
            style={[styles.hairlineTop, { backgroundColor: selectionPill.highlight }]}
          />
        </>
      ) : null}
      {state === 'inRange' ? (
        // L3 tinted — §2's "this one is different, without colour-coding
        // it". A band of fifteen saturated cells between two endpoints
        // would read as data, not as a selection.
        <LinearGradient
          colors={elevation.tinted.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <Metric value={day} size="numeral" tone={metricTone(state)} />

      {/* Fixed-height slot so a day with a marker is not taller than one
          without, which would break the grid at 200% text size. */}
      <View style={styles.markerSlot}>
        {marker ? (
          <View style={[styles.marker, { backgroundColor: marker.color }]} pointerEvents="none" />
        ) : null}
      </View>
    </Pressable>
  );
}

function metricTone(state: DayState): 'bright' | 'default' | 'muted' {
  if (state === 'selected') return 'bright';
  if (state === 'disabled') return 'muted';
  return 'default';
}

/**
 * The unselected cell is DESIGN.md §2's L2 raised recipe as the prototypes'
 * week strip renders it — a flat fill rather than a gradient, because
 * forty-two gradients in one grid is forty-two extra native views for a
 * difference nobody can see at 48px. `today` is the one cell that carries a
 * `brand` hairline; DESIGN.md §7 uses that colour for "the current one"
 * throughout.
 */
function cellSurface(state: DayState, isToday: boolean) {
  if (state === 'selected') {
    return { backgroundColor: 'transparent' as const, borderWidth: 0 };
  }
  if (state === 'disabled') {
    return { backgroundColor: control.surfaceDisabled, borderWidth: 0 };
  }
  return {
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderColor: isToday ? colors.brand.DEFAULT : colors.border.DEFAULT,
  };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: tapTarget.MIN,
    gap: densityTokens.coach.sectionGap,
  },
  headerLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
  },
  row: {
    flexDirection: 'row',
  },
  column: {
    flex: 1,
  },
  weekdayLabel: {
    textAlign: 'center',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    overflow: 'hidden',
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  markerSlot: {
    height: MARKER_SIZE,
    justifyContent: 'center',
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    // §1.4's smallest radius — half of a 6px box, i.e. a circle.
    borderRadius: radius.cell,
  },
});
