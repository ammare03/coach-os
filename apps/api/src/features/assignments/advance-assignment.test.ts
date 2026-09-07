// Pure-function unit tests — no Postgres needed, `computeAssignmentWeekProgress`
// takes and returns plain calendar dates/numbers. The most important
// property this file proves: `computeAssignmentWeekProgress`'s week
// alignment AGREES with `../../lib/materialise-sessions.ts`'s
// `calendarDateForProgramDay` — the exact "mid-week-start short-first-week
// case agreeing with task 03's materialised scheduled_dates" this task's
// verification calls out as the single most likely bug. Imports
// `calendarDateForProgramDay` read-only (never modifies that file — owned
// by a sibling task right now).
import { calendarDateForProgramDay } from '../../lib/materialise-sessions.ts';

import { computeAssignmentWeekProgress } from './advance-assignment.ts';

describe('computeAssignmentWeekProgress', () => {
  it('is week 1 on the start date itself', () => {
    const result = computeAssignmentWeekProgress('2026-08-10', '2026-08-10', 8); // a Monday
    expect(result).toEqual({ currentWeek: 1, isPastFinalWeek: false });
  });

  it('advances a full week on each Monday after a Monday start', () => {
    expect(computeAssignmentWeekProgress('2026-08-10', '2026-08-16', 8).currentWeek).toBe(1); // Sunday of week 1
    expect(computeAssignmentWeekProgress('2026-08-10', '2026-08-17', 8).currentWeek).toBe(2); // Monday of week 2
    expect(computeAssignmentWeekProgress('2026-08-10', '2026-08-24', 8).currentWeek).toBe(3); // Monday of week 3
  });

  it('is week 1 for a mid-week start, evaluated on the start date', () => {
    // 2026-08-12 is a Wednesday. Week 1 is still "this calendar week,"
    // even though it started mid-week — the same short-first-week the
    // scheduler (`../../lib/materialise-sessions.ts`) produces.
    const result = computeAssignmentWeekProgress('2026-08-12', '2026-08-12', 8);
    expect(result.currentWeek).toBe(1);
  });

  it('rolls into week 2 on the Monday after a mid-week start, not 7 days after start_date', () => {
    // Start Wednesday 2026-08-12. The following Monday, 2026-08-17, is
    // only 5 days later — a naive `floor(daysSince / 7) + 1` would still
    // say week 1. The Monday-anchored formula must say week 2.
    const result = computeAssignmentWeekProgress('2026-08-12', '2026-08-17', 8);
    expect(result.currentWeek).toBe(2);
  });

  it('caps at duration_weeks and flags isPastFinalWeek only once truly past it', () => {
    const onFinalWeek = computeAssignmentWeekProgress('2026-08-10', '2026-09-06', 4); // Sunday of week 4
    expect(onFinalWeek).toEqual({ currentWeek: 4, isPastFinalWeek: false });

    const pastFinalWeek = computeAssignmentWeekProgress('2026-08-10', '2026-09-07', 4); // Monday of week 5
    expect(pastFinalWeek).toEqual({ currentWeek: 4, isPastFinalWeek: true });
  });

  it('clamps to week 1 for a date before start_date (a future-dated assignment read early)', () => {
    const result = computeAssignmentWeekProgress('2026-08-10', '2026-08-01', 8);
    expect(result).toEqual({ currentWeek: 1, isPastFinalWeek: false });
  });

  // The cross-validation: for every (weekNumber, dayNumber) a mid-week-start
  // program actually materialises a session on, the week
  // `computeAssignmentWeekProgress` computes for THAT session's own
  // `scheduled_date` must be the same week the scheduler put it in. If
  // these two ever disagree, a coach's "week 3 of 12" and the client's
  // actual scheduled sessions disagree — this task's own stated top risk.
  describe('agrees with materialise-sessions.ts calendarDateForProgramDay', () => {
    const durationWeeks = 5;
    // One start date per weekday, so the short-first-week case is covered
    // for every possible offset, not just one.
    const startDates = [
      '2026-08-17', // Monday
      '2026-08-18', // Tuesday
      '2026-08-19', // Wednesday
      '2026-08-20', // Thursday
      '2026-08-21', // Friday
      '2026-08-22', // Saturday
      '2026-08-23', // Sunday
    ];

    it.each(startDates)('start date %s', (startDate) => {
      for (let weekNumber = 1; weekNumber <= durationWeeks; weekNumber += 1) {
        for (let dayNumber = 1; dayNumber <= 7; dayNumber += 1) {
          const scheduledDate = calendarDateForProgramDay(startDate, weekNumber, dayNumber);
          if (scheduledDate === null) continue; // short first week — nothing materialised, nothing to check

          const progress = computeAssignmentWeekProgress(startDate, scheduledDate, durationWeeks);
          expect(progress.currentWeek).toBe(weekNumber);
        }
      }
    });
  });
});
