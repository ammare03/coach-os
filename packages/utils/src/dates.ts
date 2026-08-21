// Local-calendar-day helpers. CLAUDE.md §25.5: a workout at 00:30 IST
// belongs to the client's local day, not the UTC day the server received it
// on. `workout_sessions.scheduled_date` and `meals.logged_date` are stored
// as calendar days in the *client's* timezone (DATABASE.md DB§2), never a
// timestamp — so every function here takes a timezone explicitly. None of
// them reads an ambient device/server timezone; that ambient read is
// exactly the bug this module exists to prevent.
import { addDays, endOfWeek, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * A calendar day, `"yyyy-MM-dd"`, with no time or timezone component —
 * the shape `workout_sessions.scheduled_date` and `meals.logged_date` are
 * stored in.
 */
export type CalendarDate = string;

/** A UTC instant range: `start` inclusive, `end` exclusive. */
export interface UtcInstantRange {
  start: Date;
  end: Date;
}

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertCalendarDate(date: CalendarDate): void {
  if (!CALENDAR_DATE_PATTERN.test(date)) {
    throw new RangeError(`Expected a "yyyy-MM-dd" calendar date, received "${date}"`);
  }
}

/**
 * Builds a plain JS `Date` from a calendar date's own year/month/day parts,
 * with no timezone conversion involved. Safe for calendar arithmetic
 * (`startOfWeek`, `addDays`, …) as long as it is only ever read back
 * through the matching local getters — see {@link fromCalendarArithmeticDate}.
 * Never pass this to `toISOString()`; that reinterprets it through UTC and
 * can shift the day.
 */
function toCalendarArithmeticDate(date: CalendarDate): Date {
  assertCalendarDate(date);
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/**
 * The inverse of {@link toCalendarArithmeticDate}: reads a Date's calendar
 * parts back out through the same local getters it was built with. The
 * round trip never touches the process's own timezone as an *output* —
 * only as an internal, self-cancelling implementation detail — so calendar
 * arithmetic here is identical no matter what timezone this code runs in.
 */
function fromCalendarArithmeticDate(date: Date): CalendarDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a UTC instant to the calendar date it falls on in `timeZone`.
 * The one function every date-grouped feature is built on: a workout
 * logged at 00:30 in `Asia/Kolkata` belongs to the client's next calendar
 * day, not the UTC day the server received it on.
 */
export function toLocalDate(instant: Date, timeZone: string): CalendarDate {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/**
 * The UTC instant range covering a calendar date in `timeZone`: `start` is
 * local midnight, `end` is the following local midnight (exclusive). Use
 * this to query "everything that happened on this local day" against
 * timestamp columns — it is correct across DST transitions, where the
 * local day is not exactly 24 hours.
 */
export function localDateRangeUtc(date: CalendarDate, timeZone: string): UtcInstantRange {
  assertCalendarDate(date);
  const start = fromZonedTime(`${date}T00:00:00`, timeZone);
  const nextDate = fromCalendarArithmeticDate(addDays(toCalendarArithmeticDate(date), 1));
  const end = fromZonedTime(`${nextDate}T00:00:00`, timeZone);
  return { start, end };
}

/**
 * The UTC instant range covering the calendar week containing `date`, in
 * `timeZone` — the window the adherence engine (`packages/utils`, P10)
 * scores against. Training weeks start Monday by default; pass
 * `weekStartsOn` to override.
 */
export function localWeekRangeUtc(
  date: CalendarDate,
  timeZone: string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
): UtcInstantRange {
  assertCalendarDate(date);
  const arithmeticDate = toCalendarArithmeticDate(date);
  const weekStartDate = fromCalendarArithmeticDate(startOfWeek(arithmeticDate, { weekStartsOn }));
  const weekEndDate = fromCalendarArithmeticDate(endOfWeek(arithmeticDate, { weekStartsOn }));
  const { start } = localDateRangeUtc(weekStartDate, timeZone);
  const { end } = localDateRangeUtc(weekEndDate, timeZone);
  return { start, end };
}

/**
 * Formats a UTC instant for display in `timeZone`. `formatStr` follows
 * date-fns's token table (default: a locale-agnostic long date).
 */
export function formatLocalDate(instant: Date, timeZone: string, formatStr = 'PPPP'): string {
  return formatInTimeZone(instant, timeZone, formatStr);
}
