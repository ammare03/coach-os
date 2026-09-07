import {
  COPY_BOUNDS,
  COPY_FOOTNOTE,
  copyErrorMessage,
  dayCopyActionLabel,
  dayCopySummary,
  nextFreeWeekNumber,
  takenDayOccupants,
  weekCopyActionLabel,
  weekCopySummary,
} from '../duplication.ts';

// The sheet's sentences, testable without rendering it
// (`program-builder/06`, frame 1g). Two rules are what these assertions are
// actually about: the promise names everything the transaction copies, and
// a refusal names the recovery rather than restating the constraint.

describe('what the copy promises', () => {
  it('names targets, supersets and approved swaps — the three a coach would otherwise open the copy to check', () => {
    expect(dayCopySummary({ isRestDay: false, exerciseCount: 6 })).toBe(
      '6 exercises come across, with every target, superset and approved swap.',
    );
    expect(weekCopySummary({ days: week([5, 6, 0]) })).toBe(
      '3 days and 11 exercises come across, with every target, superset and approved swap.',
    );
    expect(COPY_FOOTNOTE).toContain('targets, supersets or approved swaps');
  });

  it('singularises rather than printing "1 exercises"', () => {
    expect(dayCopySummary({ isRestDay: false, exerciseCount: 1 })).toBe(
      '1 exercise comes across, with every target, superset and approved swap.',
    );
  });

  it('states an empty day and a rest day as facts, never as a failure', () => {
    // `DESIGN.md` §10.5 — the absence of training is not a failure state,
    // and "0 exercises come across" reads like one.
    expect(dayCopySummary({ isRestDay: true, exerciseCount: 0 })).toBe(
      'A rest day copies across on its own.',
    );
    expect(dayCopySummary({ isRestDay: false, exerciseCount: 0 })).toBe(
      'This day has no exercises yet, so only the day copies across.',
    );
    expect(weekCopySummary({ days: [] })).toBe(
      'This week has no days yet, so only the week copies across.',
    );
    expect(weekCopySummary({ days: week([0, 0]) })).toBe(
      '2 days come across, with their names and rest days.',
    );
  });

  it('labels the commit with what it is about to do, never "Done"', () => {
    expect(dayCopyActionLabel(5, 3)).toBe('Copy into Wednesday of week 5');
    expect(weekCopyActionLabel(13)).toBe('Copy into week 13');
  });
});

describe('where a copy can land', () => {
  it('names the occupant of every taken slot, so the sheet can say why it is inert', () => {
    const occupants = takenDayOccupants({
      days: [
        { id: 'a', dayNumber: 1, name: 'Upper', notes: null, isRestDay: false, exerciseCount: 5 },
        { id: 'b', dayNumber: 2, name: 'Lower', notes: null, isRestDay: false, exerciseCount: 6 },
      ],
    });
    expect(occupants.get(2)).toBe('Lower');
    expect(occupants.has(3)).toBe(false);
  });

  it('appends a week copy one past the program’s last, and refuses past the ceiling', () => {
    expect(nextFreeWeekNumber([{ weekNumber: 1 }, { weekNumber: 2 }])).toBe(3);
    // Gaps do not make a week "free": the server appends past the LAST
    // week, so the sheet has to promise the same number the write will use.
    expect(nextFreeWeekNumber([{ weekNumber: 1 }, { weekNumber: 9 }])).toBe(10);
    expect(nextFreeWeekNumber([])).toBe(1);
    expect(nextFreeWeekNumber([{ weekNumber: COPY_BOUNDS.maxWeekNumber }])).toBeNull();
  });
});

describe('the backstop sentence', () => {
  // Reachable only by a stale client or a second device — the slots make
  // the collision unpickable. When it does fire it names the recovery.
  it('names the recovery for a taken day, not the constraint', () => {
    expect(copyErrorMessage('PROGRAM_DAY_TAKEN', { weekNumber: 5, dayNumber: 2 })).toBe(
      'Week 5 already has a Tuesday. Pick a free day, or open week 5 to replace it.',
    );
  });

  it('covers every refusal the two procedures can return', () => {
    expect(copyErrorMessage('PROGRAM_WEEK_EXISTS', { weekNumber: 3 })).toContain('copy again');
    expect(copyErrorMessage('PROGRAM_WEEK_LIMIT_REACHED', { weekNumber: 104 })).toContain('104');
    expect(copyErrorMessage('PROGRAM_COPY_CROSS_PROGRAM', { weekNumber: 1 })).toBe(
      'A day can only be copied inside the same program.',
    );
    expect(copyErrorMessage('NOT_YOUR_CLIENT', { weekNumber: 1 })).toContain('open the program');
  });

  it('returns null for a code this sheet does not explain, so the caller falls back', () => {
    expect(copyErrorMessage(null, { weekNumber: 1 })).toBeNull();
    expect(copyErrorMessage('INTERNAL_ERROR', { weekNumber: 1 })).toBeNull();
  });
});

function week(exerciseCounts: readonly number[]) {
  return exerciseCounts.map((exerciseCount, index) => ({
    id: `day-${String(index)}`,
    dayNumber: index + 1,
    name: `Day ${String(index + 1)}`,
    notes: null,
    isRestDay: exerciseCount === 0,
    exerciseCount,
  }));
}
