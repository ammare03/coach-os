import { dayFullLabel, dayMetaLine, dayPillLabel, weekMetaLine } from '../program-days.ts';

// The two meta lines are the only place the builder turns rows into
// sentences, and both carry a product rule rather than a format: a rest day
// is not volume, and a week with nothing in it still says how many training
// days it has.

describe('dayPillLabel / dayFullLabel', () => {
  it('maps 1-7 to Monday through Sunday', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(dayPillLabel)).toEqual([
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ]);
    expect(dayFullLabel(1)).toBe('Monday');
    expect(dayFullLabel(7)).toBe('Sunday');
  });
});

describe('weekMetaLine', () => {
  it('counts training days and their exercises', () => {
    expect(
      weekMetaLine([
        { isRestDay: false, exerciseCount: 5 },
        { isRestDay: false, exerciseCount: 6 },
        { isRestDay: false, exerciseCount: 5 },
        { isRestDay: false, exerciseCount: 2 },
      ]),
    ).toBe('4 training days · 18 exercises');
  });

  // A rest day is neither a training day nor volume (`DESIGN.md` §10.5).
  it('excludes rest days from both counts', () => {
    expect(
      weekMetaLine([
        { isRestDay: false, exerciseCount: 5 },
        { isRestDay: true, exerciseCount: 0 },
      ]),
    ).toBe('1 training day · 5 exercises');
  });

  it('drops the exercise clause entirely when there is nothing in the week yet', () => {
    expect(weekMetaLine([{ isRestDay: false, exerciseCount: 0 }])).toBe('1 training day');
    expect(weekMetaLine([])).toBe('0 training days');
  });
});

describe('dayMetaLine', () => {
  it('says what a rest day is, and never counts it', () => {
    expect(dayMetaLine({ isRestDay: true, exerciseCount: 0 })).toBe('no session');
  });

  it('singularises, and names the empty day rather than showing a zero', () => {
    expect(dayMetaLine({ isRestDay: false, exerciseCount: 1 })).toBe('1 exercise');
    expect(dayMetaLine({ isRestDay: false, exerciseCount: 5 })).toBe('5 exercises');
    expect(dayMetaLine({ isRestDay: false, exerciseCount: 0 })).toBe('no exercises yet');
  });
});
