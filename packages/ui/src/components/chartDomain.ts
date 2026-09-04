// The arithmetic behind `LineChart` and `Sparkline`, with no renderer in
// it. Two of the three functions here are the whole point of the task
// (`ui-primitives-data/04`): a chart is the most persuasive thing in the
// product and it is read by someone making a coaching decision, so the two
// ways it lies by accident are fixed here, once, as pure functions with
// tests at the boundaries rather than as options a screen can get wrong.
//
//   1. **A y-domain anchored at zero.** 84.2kg → 82.1kg over eight weeks is
//      a flat line on an axis from 0 to 90, and the client concludes
//      nothing is happening and stops weighing in.
//   2. **A line drawn through a gap.** Monday, ten silent days, Monday. A
//      straight segment between them is a picture of eleven days of steady
//      progress that never happened.
//
// Neither is a rendering bug; both are the chart asserting something the
// data does not say.

/**
 * One reading. `dateISO` is a **local calendar date** (`yyyy-MM-dd`), never
 * a timestamp and never a `Date` — `code-conventions` §6. A weigh-in stored
 * as an instant and bucketed in the device's timezone puts a Sunday-night
 * weigh-in on Monday for a coach in another country, and the client's week
 * shifts by a day. Nothing in this file constructs a `Date`, so there is no
 * timezone for the chart to get wrong.
 *
 * `value: null` is an explicit "no reading on this date" and breaks the
 * line exactly as a missing row does.
 */
export type ChartPoint = {
  dateISO: string;
  value: number | null;
};

/** The resolved vertical window. `span` is `max - min` and is always > 0. */
export type ChartDomain = {
  min: number;
  max: number;
  span: number;
};

/**
 * `minSpan` per metric — the floor that stops the OPPOSITE failure, where a
 * client whose weight moved 200g in a week gets a chart shaped like a
 * cliff. Both failures are "technically correct, communicates the wrong
 * thing", and both are resolved by `chartYDomain`.
 */
export const CHART_MIN_SPAN = {
  /** Body weight, kilograms. */
  bodyWeightKg: 4,
  /** A 0–100 adherence or completion percentage. */
  percent: 20,
  /** A 1–10 check-in scale — energy, sleep quality, soreness. */
  checkinScale: 3,
} as const;

/**
 * §7's default cadence. Consecutive readings more than this many calendar
 * days apart are not joined by a solid line. Three days is the widest hole
 * a "most days" habit can leave and still be one continuous story.
 */
export const DEFAULT_GAP_DAYS = 3;

/** The padding either side of the data, as a fraction of its range. */
const DOMAIN_PADDING = 0.1;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A `yyyy-MM-dd` string as a day number on the proleptic Gregorian
 * calendar, for spacing points along x and for measuring a gap.
 *
 * Integer arithmetic on the three fields, never `new Date(dateISO)` —
 * which parses `"2026-06-03"` as UTC midnight, renders it in the device's
 * zone, and lands on 2 June for every user west of Greenwich. That is
 * precisely the bug `CLAUDE.md` §25.5 describes, and a chart is where it
 * becomes visible.
 *
 * Returns `null` for anything that is not a real calendar date. A caller
 * treats that as a break, never as a coordinate — a malformed date is
 * unknown, and this file's whole posture is that unknown is not asserted.
 */
export function calendarDayNumber(dateISO: string): number | null {
  const match = ISO_DATE.exec(dateISO);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) return null;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;

  // Howard Hinnant's days-from-civil: shift the year to start in March so
  // the leap day is the last day of the year and needs no special case.
  const shiftedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** `"2026-06-03"` → `"3 Jun"`. An axis label, and never rotated (§13). */
export function formatAxisDate(dateISO: string): string {
  const match = ISO_DATE.exec(dateISO);
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (monthText === undefined || dayText === undefined) return dateISO;
  return `${Number(dayText)} ${MONTHS_SHORT[Number(monthText) - 1] ?? monthText}`;
}

/** `"2026-06-03"` → `"3 June"`. Spoken, so the month is a word, not an abbreviation. */
export function formatSpokenDate(dateISO: string): string {
  const match = ISO_DATE.exec(dateISO);
  const monthText = match?.[2];
  const dayText = match?.[3];
  if (monthText === undefined || dayText === undefined) return dateISO;
  return `${Number(dayText)} ${MONTHS_LONG[Number(monthText) - 1] ?? monthText}`;
}

export type ChartYDomainOptions = {
  /** The floor on `max - min`. See `CHART_MIN_SPAN`. */
  minSpan: number;
  /** A hard lower bound for the metric itself — `0` for a percentage. */
  min?: number | undefined;
  /** A hard upper bound for the metric itself — `100` for a percentage. */
  max?: number | undefined;
};

/**
 * The vertical window for a set of values.
 *
 * The data range, padded 10% each side, then widened to `minSpan` about the
 * data's own midpoint. **Zero is never introduced as a bound.** It appears
 * only when the data reaches it, or when `min` is given as a hard bound of
 * the metric (a percentage cannot go below 0, and a domain that shows −6%
 * is its own kind of lie).
 *
 * When `minSpan` would push the window past a hard bound, the window is
 * SLID rather than shrunk: 92–96% with a 20-point floor renders 80–100,
 * not 86–100. Shrinking would silently drop the floor the caller asked for.
 *
 * Returns `null` when there is nothing finite to plot — the caller renders
 * its empty state rather than a chart of a fabricated range.
 */
export function chartYDomain(
  values: readonly number[],
  { minSpan, min: hardMin, max: hardMax }: ChartYDomainOptions,
): ChartDomain | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;

  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  const padding = (dataMax - dataMin) * DOMAIN_PADDING;

  let min = dataMin - padding;
  let max = dataMax + padding;

  // A flat series and a single point both land here, and both must sit in
  // the MIDDLE of the window — a flat line pinned to the top or bottom edge
  // reads as "at the limit of something".
  const floor = Math.max(minSpan, 0);
  if (max - min < floor) {
    const midpoint = (dataMin + dataMax) / 2;
    min = midpoint - floor / 2;
    max = midpoint + floor / 2;
  }

  if (hardMin !== undefined && min < hardMin) {
    const shift = hardMin - min;
    min = hardMin;
    max += shift;
  }
  if (hardMax !== undefined && max > hardMax) {
    const shift = max - hardMax;
    max = hardMax;
    min = hardMin === undefined ? min - shift : Math.max(hardMin, min - shift);
  }

  // Clamping BOTH bounds can leave a window narrower than `minSpan` — 0–100
  // under a 200-point floor. That is a legitimate outcome; a zero-width one
  // is not, because every value would then divide by zero.
  if (max <= min) {
    max = min + (floor > 0 ? floor : 1);
  }

  return { min, max, span: max - min };
}

/**
 * A run of consecutive plotted points, and the holes between runs.
 *
 * Indices refer back into the ORIGINAL `points` array, so a caller can
 * report the selected point without a second lookup table.
 */
export type ChartSeriesShape = {
  /** Every index whose value is finite, in date order. */
  plotted: readonly number[];
  /** Runs of indices joined by a solid line. Never empty, never length 0. */
  runs: readonly (readonly number[])[];
  /**
   * `[lastOfRun, firstOfNextRun]` for each hole. Rendered dashed and dimmed
   * — the reader sees that there is a relationship without seeing an
   * assertion about the days in between.
   */
  bridges: readonly (readonly [number, number])[];
  /** Calendar day number of the first and last plotted point. */
  dayMin: number;
  dayMax: number;
};

const EMPTY_SHAPE: ChartSeriesShape = {
  plotted: [],
  runs: [],
  bridges: [],
  dayMin: 0,
  dayMax: 0,
};

/**
 * Splits a series into solid runs and dashed bridges.
 *
 * A point breaks the line when its value is not finite, when its date does
 * not parse, or when it is more than `gapDays` calendar days after the
 * previous plotted point. Exactly `gapDays` apart is still consecutive —
 * the default cadence of 3 means Monday→Thursday is one line and
 * Monday→Friday is not.
 *
 * Points are assumed to arrive in date order, which is what a `date`-column
 * `ORDER BY` produces. An out-of-order point is treated as a break rather
 * than sorted behind the caller's back: re-ordering data to make a chart
 * look continuous is the same lie as bridging a gap.
 */
export function chartSeriesShape(
  points: readonly ChartPoint[],
  gapDays: number = DEFAULT_GAP_DAYS,
): ChartSeriesShape {
  const plotted: number[] = [];
  const runs: number[][] = [];
  const bridges: (readonly [number, number])[] = [];

  let currentRun: number[] | null = null;
  let previousIndex: number | null = null;
  let previousDay: number | null = null;
  let dayMin = Number.POSITIVE_INFINITY;
  let dayMax = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;

    const day = calendarDayNumber(point.dateISO);
    const value = point.value;
    if (day === null || value === null || !Number.isFinite(value)) {
      // An unknown reading ends the run. It does not start a bridge either:
      // a bridge says "these two readings are related"; a null says nothing.
      currentRun = null;
      continue;
    }

    plotted.push(index);
    dayMin = Math.min(dayMin, day);
    dayMax = Math.max(dayMax, day);

    const elapsed = previousDay === null ? 0 : day - previousDay;
    const continues =
      currentRun !== null && previousDay !== null && elapsed > 0 && elapsed <= gapDays;

    if (continues && currentRun !== null) {
      currentRun.push(index);
    } else {
      if (
        currentRun !== null &&
        previousIndex !== null &&
        previousDay !== null &&
        day > previousDay
      ) {
        bridges.push([previousIndex, index] as const);
      }
      currentRun = [index];
      runs.push(currentRun);
    }

    previousIndex = index;
    previousDay = day;
  }

  if (plotted.length === 0) return EMPTY_SHAPE;

  return { plotted, runs, bridges, dayMin, dayMax };
}

/** `'up' | 'down' | 'flat'` from the first and last plotted value. */
export type ChartTrend = 'up' | 'down' | 'flat';

export function chartTrend(points: readonly ChartPoint[]): ChartTrend | null {
  // `gapDays` changes how the line is DRAWN, never which points exist, so
  // the default is fine here: the first and last plotted readings are the
  // same whatever the cadence.
  const shape = chartSeriesShape(points, DEFAULT_GAP_DAYS);
  const firstIndex = shape.plotted[0];
  const lastIndex = shape.plotted[shape.plotted.length - 1];
  if (firstIndex === undefined || lastIndex === undefined) return null;

  const first = points[firstIndex]?.value;
  const last = points[lastIndex]?.value;
  if (first == null || last == null) return null;
  if (last === first) return 'flat';
  return last > first ? 'up' : 'down';
}

const TREND_WORD: Record<ChartTrend, string> = {
  up: 'trending up',
  // §10.4 — a flat number gets no arrow and no colour. It gets a word.
  flat: 'unchanged',
  down: 'trending down',
};

export type ChartSummaryInput = {
  /** What the series is: `"Weight"`, `"Energy"`. */
  label: string;
  points: readonly ChartPoint[];
  /** Spoken, so `"kilograms"` and not `"kg"` (`accessibility` §2). */
  unitLabel?: string | undefined;
  /** The series' cadence, so the sentence counts the same gaps the line shows. */
  gapDays?: number | undefined;
};

/**
 * The one sentence a screen reader hears instead of the chart —
 * *"Weight, 12 entries from 3 June to 1 July, 84.2 down to 82.1 kilograms,
 * trending down"*.
 *
 * A path is invisible to a screen reader and reading out forty coordinates
 * is worse than reading out nothing. This is the whole accessibility story
 * for a chart, together with the affordance that opens the same data as a
 * list — a client using VoiceOver has the same right to their own weight
 * history as anyone else.
 */
export function chartSummary({
  label,
  points,
  unitLabel,
  gapDays = DEFAULT_GAP_DAYS,
}: ChartSummaryInput): string {
  const shape = chartSeriesShape(points, gapDays);
  const count = shape.plotted.length;
  const unitSuffix = unitLabel ? ` ${unitLabel}` : '';

  if (count === 0) return `${label}, no entries yet`;

  const firstIndex = shape.plotted[0];
  const lastIndex = shape.plotted[count - 1];
  if (firstIndex === undefined || lastIndex === undefined) return `${label}, no entries yet`;

  const first = points[firstIndex];
  const last = points[lastIndex];
  if (first?.value == null || last?.value == null) return `${label}, no entries yet`;

  if (count === 1) {
    return `${label}, one entry on ${formatSpokenDate(first.dateISO)}, ${first.value}${unitSuffix}`;
  }

  const trend = last.value === first.value ? 'flat' : last.value > first.value ? 'up' : 'down';
  const gapNote = shape.bridges.length > 0 ? `, ${describeGaps(shape.bridges.length)}` : '';

  return (
    `${label}, ${count} entries from ${formatSpokenDate(first.dateISO)} to ` +
    `${formatSpokenDate(last.dateISO)}, ${first.value} to ${last.value}${unitSuffix}, ` +
    `${TREND_WORD[trend]}${gapNote}`
  );
}

// The gaps are visible to a sighted reader as dashed segments, so they are
// spoken too. Without this the summary asserts a continuity the chart
// itself is careful not to.
function describeGaps(count: number): string {
  return count === 1 ? 'with one gap in the readings' : `with ${count} gaps in the readings`;
}

/**
 * Which points carry an x label. Four to six across the width, never more,
 * and always including the first and the last — the two a reader actually
 * uses to place the series in time. Labels reduce in COUNT rather than
 * rotating or shrinking, because rotated axis labels at 200% text size are
 * unreadable and clip (`accessibility` §3).
 */
export function chartAxisLabelIndices(count: number, maxLabels: number): readonly number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];

  const slots = Math.max(2, Math.min(maxLabels, count));
  const indices: number[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    const index = Math.round((slot * (count - 1)) / (slots - 1));
    if (indices[indices.length - 1] !== index) indices.push(index);
  }
  return indices;
}
