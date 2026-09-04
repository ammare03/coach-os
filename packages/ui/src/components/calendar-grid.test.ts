import {
  addDays,
  addMonths,
  compareCalendarDates,
  dayOfWeek,
  daysInMonth,
  endOfMonth,
  firstDayOfWeek,
  formatCalendarDate,
  isWithinBounds,
  monthGrid,
  monthName,
  parseCalendarDate,
  spokenDate,
  startOfMonth,
  weekdayLabels,
} from './calendar-grid.ts';

describe('calendar-grid', () => {
  describe('parseCalendarDate', () => {
    it('rejects anything that is not a real "yyyy-MM-dd" day', () => {
      expect(() => parseCalendarDate('2026-9-1')).toThrow(RangeError);
      expect(() => parseCalendarDate('2026-13-01')).toThrow(RangeError);
      expect(() => parseCalendarDate('2026-02-30')).toThrow(RangeError);
      expect(() => parseCalendarDate('2026-02-29')).toThrow(RangeError);
      expect(parseCalendarDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    });
  });

  describe('daysInMonth', () => {
    it('handles leap years and the century rule', () => {
      expect(daysInMonth(2024, 2)).toBe(29);
      expect(daysInMonth(2026, 2)).toBe(28);
      expect(daysInMonth(2000, 2)).toBe(29);
      expect(daysInMonth(1900, 2)).toBe(28);
      expect(daysInMonth(2026, 12)).toBe(31);
    });
  });

  describe('addMonths', () => {
    it('clamps the day rather than rolling into the next month', () => {
      expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
      expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
      expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    });

    it('crosses a year boundary in both directions', () => {
      expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
      expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
      expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
      expect(addMonths('2026-06-01', 30)).toBe('2028-12-01');
    });
  });

  it('walks days across month and year boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('reports the UTC weekday, never the device one', () => {
    // 2026-09-01 is a Tuesday.
    expect(dayOfWeek('2026-09-01')).toBe(2);
    expect(dayOfWeek('2026-09-06')).toBe(0);
  });

  it('finds the ends of a month', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(endOfMonth('2026-09-17')).toBe('2026-09-30');
    expect(endOfMonth('2024-02-05')).toBe('2024-02-29');
  });

  it('orders dates chronologically', () => {
    expect(compareCalendarDates('2026-09-01', '2026-09-02')).toBe(-1);
    expect(compareCalendarDates('2026-10-01', '2026-09-30')).toBe(1);
    expect(compareCalendarDates('2026-09-01', '2026-09-01')).toBe(0);
  });

  it('bounds a date against an optional min and max', () => {
    expect(isWithinBounds('2026-09-15')).toBe(true);
    expect(isWithinBounds('2026-09-15', '2026-09-16')).toBe(false);
    expect(isWithinBounds('2026-09-15', undefined, '2026-09-14')).toBe(false);
    expect(isWithinBounds('2026-09-15', '2026-09-01', '2026-09-30')).toBe(true);
  });

  describe('monthGrid', () => {
    it('pads to whole weeks and never emits a neighbouring month day', () => {
      // September 2026: 1st is a Tuesday, 30 days.
      const weeks = monthGrid('2026-09-01', 1);

      expect(weeks).toHaveLength(5);
      expect(weeks.every((week) => week.length === 7)).toBe(true);
      expect(weeks[0]).toEqual([
        null,
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
      ]);
      expect(weeks[4]?.slice(3)).toEqual([null, null, null, null]);

      const days = weeks.flat().filter((cell): cell is string => cell !== null);
      expect(days).toHaveLength(30);
      expect(days.every((day) => day.startsWith('2026-09'))).toBe(true);
    });

    it('re-pads when the week starts on Sunday', () => {
      const weeks = monthGrid('2026-09-01', 0);
      expect(weeks[0]).toEqual([
        null,
        null,
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
      ]);
    });

    it('needs six rows for a 31-day month that starts on the last weekday', () => {
      // August 2026 starts on a Saturday; Monday-first, that spills to six.
      expect(monthGrid('2026-08-01', 1)).toHaveLength(6);
    });

    it('accepts any day of the month, not only the first', () => {
      expect(monthGrid('2026-09-23', 1)).toEqual(monthGrid('2026-09-01', 1));
    });

    it('places 1 February 2027 correctly (leading-zero month arithmetic)', () => {
      const weeks = monthGrid('2027-02-01', 1);
      expect(weeks[0]?.[0]).toBe('2027-02-01');
    });
  });

  describe('firstDayOfWeek', () => {
    it('is locale-aware', () => {
      expect(firstDayOfWeek('en-US')).toBe(0);
      expect(firstDayOfWeek('en-GB')).toBe(1);
      expect(firstDayOfWeek('fr-FR')).toBe(1);
      expect(firstDayOfWeek('en-IN')).toBe(0);
      expect(firstDayOfWeek('ar-EG')).toBe(6);
    });

    it('falls back to Monday for a tag with no region', () => {
      expect(firstDayOfWeek('eo')).toBe(1);
    });
  });

  describe('weekdayLabels', () => {
    it('rotates to the requested first day', () => {
      expect(weekdayLabels(1, 'en-US')[0]).toMatch(/^Mon/);
      expect(weekdayLabels(0, 'en-US')[0]).toMatch(/^Sun/);
      expect(weekdayLabels(6, 'en-US')[0]).toMatch(/^Sat/);
    });

    it('always returns exactly seven distinct names', () => {
      const labels = weekdayLabels(1, 'en-US');
      expect(labels).toHaveLength(7);
      expect(new Set(labels).size).toBe(7);
    });
  });

  it('formats a month name and a spoken date in UTC, never the device zone', () => {
    expect(monthName('2026-09-01', 'en-US')).toBe('September');
    // Midnight-boundary dates are where a Date-based picker slips a day.
    expect(spokenDate('2026-01-01', 'en-US')).toContain('January 1, 2026');
    expect(spokenDate('2026-12-31', 'en-US')).toContain('December 31, 2026');
  });

  it('round-trips through formatCalendarDate', () => {
    expect(formatCalendarDate(2026, 9, 5)).toBe('2026-09-05');
    expect(parseCalendarDate(formatCalendarDate(2026, 9, 5))).toEqual({
      year: 2026,
      month: 9,
      day: 5,
    });
  });
});
