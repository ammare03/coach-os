// Month-grid arithmetic for `Calendar`, isolated from the renderer so the
// part that is easy to get wrong is testable without one.
//
// Two rules govern every function here:
//
// 1. **A date is a `"yyyy-MM-dd"` string, never a JS `Date`.** This is the
//    same discipline `packages/utils/src/dates.ts` enforces for the app's
//    calendar days (CLAUDE.md §25.5) — a date picker is precisely where the
//    `Date`-object habit reintroduces the timezone hazard, since a
//    `Date` built from "2026-09-01" is a UTC *instant* that is 31 August in
//    half the world.
// 2. **No ambient timezone is ever read.** Where a `Date` is unavoidable
//    (weekday-of-month, month length, locale formatting) it is built with
//    `Date.UTC` and read back through `getUTC*`/`timeZone: 'UTC'`, so this
//    file computes the same grid on a phone in Kolkata and a CI box in UTC.
//
// `packages/ui` deliberately takes no `date-fns` dependency of its own —
// the whole of what a month grid needs is below, and a UI package pulling a
// date library in for it would be a §3 stack change.
import type { CalendarDate } from '@coachos/utils';

/** `0` = Sunday … `6` = Saturday, matching `Date#getUTCDay`. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One position in the month grid. `null` is a leading/trailing pad cell. */
export type CalendarCell = CalendarDate | null;

export interface CalendarDateParts {
  year: number;
  /** 1–12, not `Date`'s 0–11. */
  month: number;
  day: number;
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_PER_WEEK = 7;

/** Extracts the region subtag without needing `Intl.Locale`, which Hermes may not ship. */
const REGION_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2}|\d{3})\b/;

export function parseCalendarDate(date: CalendarDate): CalendarDateParts {
  if (!CALENDAR_DATE_PATTERN.test(date)) {
    throw new RangeError(`Expected a "yyyy-MM-dd" calendar date, received "${date}"`);
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`"${date}" is not a real calendar date`);
  }
  return { year, month, day };
}

export function formatCalendarDate(year: number, month: number, day: number): CalendarDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day count of a 1-indexed month. Day 0 of the next month is the last day of this one. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `0` = Sunday … `6` = Saturday. */
export function dayOfWeek(date: CalendarDate): WeekStart {
  const { year, month, day } = parseCalendarDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as WeekStart;
}

/** The first of `date`'s month — the canonical form of a "visible month" value. */
export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parseCalendarDate(date);
  return formatCalendarDate(year, month, 1);
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parseCalendarDate(date);
  return formatCalendarDate(year, month, daysInMonth(year, month));
}

/** Clamps the day, so 31 January + 1 month is 28/29 February, never 3 March. */
export function addMonths(date: CalendarDate, delta: number): CalendarDate {
  const { year, month, day } = parseCalendarDate(date);
  const shifted = year * 12 + (month - 1) + delta;
  const targetYear = Math.floor(shifted / 12);
  const targetMonth = (shifted % 12) + 1;
  return formatCalendarDate(
    targetYear,
    targetMonth,
    Math.min(day, daysInMonth(targetYear, targetMonth)),
  );
}

export function addDays(date: CalendarDate, delta: number): CalendarDate {
  const { year, month, day } = parseCalendarDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return formatCalendarDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Chronological order. Zero-padded ISO days sort lexicographically, so this
 * is a string compare — but it is named, because `a < b` on two dates reads
 * like a bug even when it is not.
 */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isWithinBounds(
  date: CalendarDate,
  minDate?: CalendarDate,
  maxDate?: CalendarDate,
): boolean {
  if (minDate !== undefined && compareCalendarDates(date, minDate) < 0) return false;
  if (maxDate !== undefined && compareCalendarDates(date, maxDate) > 0) return false;
  return true;
}

/**
 * The weeks of `month` as rows of seven, padded with `null` outside the
 * month. Pad cells are `null` rather than the neighbouring month's dates:
 * dimming a real, tappable date would make `fg.faint` carry the meaning
 * "not this month", which DESIGN.md §13 forbids it from doing.
 */
export function monthGrid(month: CalendarDate, weekStartsOn: WeekStart): CalendarCell[][] {
  const { year, month: monthNumber } = parseCalendarDate(month);
  const total = daysInMonth(year, monthNumber);
  const firstDow = dayOfWeek(formatCalendarDate(year, monthNumber, 1));
  const lead = (firstDow - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;

  const cells: CalendarCell[] = [
    ...Array.from({ length: lead }, (): CalendarCell => null),
    ...Array.from({ length: total }, (_unused, i) => formatCalendarDate(year, monthNumber, i + 1)),
  ];
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += DAYS_PER_WEEK) {
    weeks.push(cells.slice(i, i + DAYS_PER_WEEK));
  }
  return weeks;
}

// `Intl.Locale#getWeekInfo` is the only standard source for a locale's own
// first day of the week, and it is stage-3: present in modern JSC/V8, absent
// from Hermes builds without full ICU. Typed structurally and reached
// through a cast so a missing implementation is a runtime `undefined`, not
// a crash.
interface WeekInfoLike {
  firstDay: number;
}
interface LocaleLike {
  getWeekInfo?: () => WeekInfoLike;
  weekInfo?: WeekInfoLike;
}

// The regions that do not start the week on Monday. Everywhere absent from
// both sets falls through to Monday, which is both the global majority and
// `packages/utils`' own default for a training week.
const SUNDAY_FIRST_REGIONS = new Set([
  'AG',
  'AS',
  'AU',
  'BD',
  'BR',
  'BS',
  'BT',
  'BW',
  'BZ',
  'CA',
  'CN',
  'CO',
  'DM',
  'DO',
  'ET',
  'GT',
  'GU',
  'HK',
  'HN',
  'ID',
  'IL',
  'IN',
  'JM',
  'JP',
  'KE',
  'KH',
  'KR',
  'LA',
  'MH',
  'MM',
  'MO',
  'MT',
  'MX',
  'MZ',
  'NI',
  'NP',
  'PA',
  'PE',
  'PH',
  'PK',
  'PR',
  'PT',
  'PY',
  'SA',
  'SG',
  'SV',
  'TH',
  'TT',
  'TW',
  'UM',
  'US',
  'VE',
  'VI',
  'WS',
  'YE',
  'ZA',
  'ZW',
]);
const SATURDAY_FIRST_REGIONS = new Set([
  'AE',
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);

/** The tag the runtime actually resolved — `undefined` means the device default. */
export function resolveLocale(locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale).resolvedOptions().locale;
  } catch {
    return locale ?? 'en-US';
  }
}

/**
 * The locale's own first day of the week. `Intl.Locale#getWeekInfo` where
 * the runtime has it; otherwise the region table above. Callers may still
 * override with an explicit `weekStartsOn`.
 */
export function firstDayOfWeek(locale?: string): WeekStart {
  const tag = resolveLocale(locale);

  const LocaleCtor = (Intl as unknown as { Locale?: new (tag: string) => LocaleLike }).Locale;
  if (typeof LocaleCtor === 'function') {
    try {
      const resolved = new LocaleCtor(tag);
      const info = resolved.getWeekInfo?.() ?? resolved.weekInfo;
      // `firstDay` is 1 (Monday) … 7 (Sunday); `getUTCDay` is 0 (Sunday) … 6.
      if (info) return (info.firstDay % DAYS_PER_WEEK) as WeekStart;
    } catch {
      // Fall through to the region table.
    }
  }

  const region = REGION_PATTERN.exec(tag)?.[1]?.toUpperCase();
  if (region !== undefined && SUNDAY_FIRST_REGIONS.has(region)) return 0;
  if (region !== undefined && SATURDAY_FIRST_REGIONS.has(region)) return 6;
  return 1;
}

// 2024-01-07 is a Sunday, so `+ index` walks Sunday → Saturday.
const WEEKDAY_REFERENCE = Date.UTC(2024, 0, 7);
const FALLBACK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Seven short weekday names, rotated so index 0 is `weekStartsOn`. */
export function weekdayLabels(weekStartsOn: WeekStart, locale?: string): string[] {
  let names = FALLBACK_WEEKDAYS;
  try {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    names = Array.from({ length: DAYS_PER_WEEK }, (_unused, i) =>
      format.format(new Date(WEEKDAY_REFERENCE + i * 86_400_000)),
    );
  } catch {
    // Keep the English fallback.
  }
  return Array.from(
    { length: DAYS_PER_WEEK },
    (_unused, i) => names[(weekStartsOn + i) % DAYS_PER_WEEK] ?? '',
  );
}

function formatWithParts(
  date: CalendarDate,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string | undefined {
  const { year, month, day } = parseCalendarDate(date);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
  } catch {
    return undefined;
  }
}

const FALLBACK_MONTHS = [
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
];

/** The month's name alone — the year is rendered separately, through `Metric`. */
export function monthName(month: CalendarDate, locale?: string): string {
  return (
    formatWithParts(month, locale, { month: 'long' }) ??
    FALLBACK_MONTHS[parseCalendarDate(month).month - 1] ??
    ''
  );
}

/** The full date, for a screen reader. Never shown visually. */
export function spokenDate(date: CalendarDate, locale?: string): string {
  return formatWithParts(date, locale, { day: 'numeric', month: 'long', year: 'numeric' }) ?? date;
}
