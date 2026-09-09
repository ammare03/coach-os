// Local-calendar-day helpers. CLAUDE.md §25.5: a workout at 00:30 IST
// belongs to the client's local day, not the UTC day the server received it
// on. `workout_sessions.scheduled_date` and `meals.logged_date` are stored
// as calendar days in the *client's* timezone (DATABASE.md DB§2), never a
// timestamp — so every function here takes a timezone explicitly. None of
// them reads an ambient device/server timezone; that ambient read is
// exactly the bug this module exists to prevent.
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  formatDistance,
  getISODay,
  startOfWeek,
} from 'date-fns';
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
 * Adds (or, for a negative `days`, subtracts) whole calendar days to a
 * calendar date. Pure date arithmetic — no timezone involved, and none
 * needed: a calendar date has no instant to convert. This was the one "add
 * N calendar days" helper this file didn't already have
 * (`assignment/03-session-materialisation.md`'s walk from
 * `assignments.start_date`, itself already a client-local calendar day per
 * DATABASE.md DB§5.2, through a program's week/day structure — there is no
 * UTC instant anywhere in that walk for a timezone to apply to). Add here,
 * never reimplement locally — `CLAUDE.md` §25.5's whole point.
 */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  return fromCalendarArithmeticDate(addDays(toCalendarArithmeticDate(date), days));
}

/**
 * The ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. Also pure
 * calendar arithmetic — used to align `training.program_days.day_number`
 * (CHECKed 1–7, DB§5.2) to real calendar weekdays rather than treating it
 * as a sequential offset from an assignment's `start_date`
 * (`assignment/03`'s resolution of that exact question).
 */
export function isoWeekdayOfCalendarDate(date: CalendarDate): number {
  return getISODay(toCalendarArithmeticDate(date));
}

/**
 * Whole calendar days from `from` to `to` (negative if `to` precedes
 * `from`). Pure calendar arithmetic, the inverse of {@link addCalendarDays}
 * — added for `assignment/05-week-advance-and-completion.md`'s
 * `current_week` computation, which needs "how many calendar weeks has the
 * client been in this program" as a plain day-count divided by 7, aligned
 * to the same Monday-of-week-one anchor `assignment/03`'s
 * `calendarDateForProgramDay` uses. This was the one day-difference helper
 * this file didn't already have; add future date math here, never
 * reimplement it in `apps/api` (`CLAUDE.md` §25.5).
 */
export function diffCalendarDays(from: CalendarDate, to: CalendarDate): number {
  return differenceInCalendarDays(toCalendarArithmeticDate(to), toCalendarArithmeticDate(from));
}

/**
 * Formats a UTC instant for display in `timeZone`. `formatStr` follows
 * date-fns's token table (default: a locale-agnostic long date).
 */
export function formatLocalDate(instant: Date, timeZone: string, formatStr = 'PPPP'): string {
  return formatInTimeZone(instant, timeZone, formatStr);
}

/**
 * "2 days ago", "about 1 month ago" — a coach scanning a list of things
 * they edited, not a day-boundary decision, so unlike everything else in
 * this file it takes no timezone: elapsed time since `instant` reads the
 * same everywhere (`program-templates/01`'s templates-list meta line).
 *
 * `now` defaults to the current instant — this package's one ambient clock
 * read (`code-conventions` §1: `packages/utils` is pure functions only, no
 * I/O). Built on `formatDistance(instant, now)` rather than date-fns's own
 * `formatDistanceToNow(instant)`, which always calls `Date.now()`
 * internally and has no way to accept a fixed `now`; passing `now`
 * explicitly makes this function itself pure and its result deterministic,
 * and the default keeps every existing call site compiling unchanged.
 */
export function formatRelativeToNow(instant: Date, now: Date = new Date()): string {
  return formatDistance(instant, now, { addSuffix: true });
}
