// Day-slot vocabulary for the builder. `program_days.day_number` is 1-7
// (DB§5.2's `program_days_day_number_check`), read here as Monday through
// Sunday — a slot in a training week, not a calendar date, so nothing in
// this file touches `date-fns` or a timezone (`code-conventions` §6).

export const DAY_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

export type DaySlot = (typeof DAY_SLOTS)[number];

/** The 40x30 pill's label — uppercase, three letters, tabular by shape. */
export const DAY_PILL_LABEL: Record<number, string> = {
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
  7: 'SUN',
};

/** What a screen reader says, and what the add-day sheet's slots are labelled. */
export const DAY_FULL_LABEL: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

export function dayPillLabel(dayNumber: number): string {
  return DAY_PILL_LABEL[dayNumber] ?? String(dayNumber);
}

export function dayFullLabel(dayNumber: number): string {
  return DAY_FULL_LABEL[dayNumber] ?? `Day ${dayNumber}`;
}

/**
 * The week header's meta line — "4 training days · 18 exercises". Rest days
 * are excluded from the count deliberately: a coach scanning twelve week
 * headers is counting sessions, and a week of seven rest days is not a
 * seven-day week (`DESIGN.md` §10.5 — absence of training is not failure,
 * and it is not volume either).
 */
export function weekMetaLine(
  days: readonly { isRestDay: boolean; exerciseCount: number }[],
): string {
  const trainingDays = days.filter((day) => !day.isRestDay);
  const exercises = trainingDays.reduce((total, day) => total + day.exerciseCount, 0);
  const dayPart = `${trainingDays.length} training ${trainingDays.length === 1 ? 'day' : 'days'}`;
  if (exercises === 0) return dayPart;
  return `${dayPart} · ${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}`;
}

/** The day row's meta line — "5 exercises", or the rest day's own quiet note. */
export function dayMetaLine(day: { isRestDay: boolean; exerciseCount: number }): string {
  if (day.isRestDay) return 'no session';
  if (day.exerciseCount === 0) return 'no exercises yet';
  return `${day.exerciseCount} ${day.exerciseCount === 1 ? 'exercise' : 'exercises'}`;
}
