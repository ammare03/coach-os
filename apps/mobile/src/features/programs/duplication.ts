import { programs as programsSchemas, type AppErrorCode } from '@coachos/schemas';

import type { ProgramDay, ProgramWeek } from './api/programs.ts';
import { dayFullLabel } from './program-days.ts';

// The copy-to sheet's vocabulary (`program-builder/06`, frame 1g) — kept
// out of the component so every sentence the sheet says is testable
// without rendering it, the same split `program-days.ts` and
// `supersets.ts` already make.
//
// Two rules run through all of it:
//
// 1. **Collision is prevented, not reported.** `takenDayOccupants` is what
//    makes a slot inert and names its occupant, so the coach cannot pick
//    the failure. `copyErrorMessage` is the backstop for a stale client,
//    and when it fires it names the recovery rather than restating the
//    constraint.
// 2. **The sheet promises exactly what the transaction copies.** A partial
//    copy that looked complete is the risk the task exists to prevent, so
//    the summary and the footnote both name targets, supersets and
//    approved swaps — the three things a coach would otherwise have to
//    open the copy to check.

export const COPY_BOUNDS = {
  maxWeekNumber: programsSchemas.PROGRAM_BOUNDS.maxWeekNumber,
} as const;

/** Day number → the name of the session already in that slot. */
export function takenDayOccupants(week: Pick<ProgramWeek, 'days'>): Map<number, string> {
  return new Map(week.days.map((day) => [day.dayNumber, day.name]));
}

/**
 * The week a copied week would land in — one past the program's current
 * last, exactly what the server appends to when no number is sent. `null`
 * once the program is at the 104-week ceiling: there is no next week, and
 * the commit says so rather than failing on press.
 */
export function nextFreeWeekNumber(
  weeks: readonly Pick<ProgramWeek, 'weekNumber'>[],
): number | null {
  const last = weeks.reduce((highest, week) => Math.max(highest, week.weekNumber), 0);
  const next = last + 1;
  return next > COPY_BOUNDS.maxWeekNumber ? null : next;
}

function exercisePhrase(count: number): string {
  return `${String(count)} ${count === 1 ? 'exercise' : 'exercises'}`;
}

function dayPhrase(count: number): string {
  return `${String(count)} ${count === 1 ? 'day' : 'days'}`;
}

/** Whole sentences, never fragments joined at the call site (`COPY.md` CO§5). */
function comesAcross(subject: string, isSingular: boolean): string {
  return `${subject} ${isSingular ? 'comes' : 'come'} across, with every target, superset and approved swap.`;
}

/**
 * The line at the top of the sheet: what is about to be copied, stated
 * before the coach commits to it. A rest day and an empty day both say so
 * outright — "0 exercises come across" reads like a failure, and neither
 * is one (`DESIGN.md` §10.5).
 */
export function dayCopySummary(day: Pick<ProgramDay, 'isRestDay' | 'exerciseCount'>): string {
  if (day.isRestDay) return 'A rest day copies across on its own.';
  if (day.exerciseCount === 0)
    return 'This day has no exercises yet, so only the day copies across.';
  return comesAcross(exercisePhrase(day.exerciseCount), day.exerciseCount === 1);
}

/** The same promise for a whole week — every day, and everything under every day. */
export function weekCopySummary(week: Pick<ProgramWeek, 'days'>): string {
  const days = week.days.length;
  if (days === 0) return 'This week has no days yet, so only the week copies across.';
  const exercises = week.days.reduce((total, day) => total + day.exerciseCount, 0);
  if (exercises === 0) {
    return `${dayPhrase(days)} ${days === 1 ? 'comes' : 'come'} across, with their names and rest days.`;
  }
  return comesAcross(`${dayPhrase(days)} and ${exercisePhrase(exercises)}`, false);
}

/**
 * The footnote under the commit. It answers the question the summary
 * raises and the design's frame does not: whether the copy is a second
 * view of the same session or a session of its own. It is its own — which
 * is what "fresh ids" means to a coach.
 */
export const COPY_FOOTNOTE =
  'The copy is a new session. Editing its targets, supersets or approved swaps never changes the original.';

/** The commit label when a destination is chosen — an action label, never "Done" (`DESIGN.md` §10.8). */
export function dayCopyActionLabel(weekNumber: number, dayNumber: number): string {
  return `Copy into ${dayFullLabel(dayNumber)} of week ${String(weekNumber)}`;
}

export function weekCopyActionLabel(weekNumber: number): string {
  return `Copy into week ${String(weekNumber)}`;
}

/**
 * The inert commit's label. It says what is missing, never a silent grey
 * button the coach has to guess at (`ui-conventions` §4, frame 1g).
 */
export const DAY_COPY_INERT_LABEL = 'Pick a free day to copy into';
export const WEEK_COPY_INERT_LABEL = 'This program is already 104 weeks long';

/**
 * What the destination line says at that ceiling — the fact behind the
 * inert button, so the two are not the same sentence printed twice.
 */
export const WEEK_COPY_CEILING_NOTE = `A program can run for ${String(COPY_BOUNDS.maxWeekNumber)} weeks at most, and this one already does. Delete a week to make room.`;

/**
 * The backstop sentence, for the refusals only a stale client or a second
 * device can reach. Every one of them names what to do next
 * (`ERRORS.md` ER§0.1); `null` means "not a refusal this sheet explains",
 * and the caller falls back to its generic save error.
 */
export function copyErrorMessage(
  code: AppErrorCode | null,
  target: { weekNumber: number; dayNumber?: number | undefined },
): string | null {
  switch (code) {
    case 'PROGRAM_DAY_TAKEN':
      return target.dayNumber === undefined
        ? 'That day already has a session. Pick a free day.'
        : `Week ${String(target.weekNumber)} already has a ${dayFullLabel(target.dayNumber)}. Pick a free day, or open week ${String(target.weekNumber)} to replace it.`;
    case 'PROGRAM_WEEK_EXISTS':
      return `Week ${String(target.weekNumber)} is already in this program. Refresh and copy again.`;
    case 'PROGRAM_WEEK_LIMIT_REACHED':
      return `A program can run for ${String(COPY_BOUNDS.maxWeekNumber)} weeks at most.`;
    case 'PROGRAM_COPY_CROSS_PROGRAM':
      return 'A day can only be copied inside the same program.';
    case 'NOT_YOUR_CLIENT':
      return 'That week is no longer here. Go back and open the program again.';
    default:
      return null;
  }
}
