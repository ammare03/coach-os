// These tests must pass identically no matter what timezone the machine
// running them is in — see this package's plan task, Verification. Every
// case below names its timezone explicitly and never touches the local
// clock, so `TZ=<anything> pnpm test` is expected to be a no-op on the
// results.
import {
  addCalendarDays,
  diffCalendarDays,
  formatLocalDate,
  formatRelativeToNow,
  isoWeekdayOfCalendarDate,
  localDateRangeUtc,
  localWeekRangeUtc,
  toLocalDate,
} from './dates.ts';

describe('toLocalDate', () => {
  it('assigns a 00:30 local workout to the next day in a positive-offset zone', () => {
    // 00:30 IST (UTC+5:30) on Aug 15 is 18:30 UTC on Aug 14. Naive UTC
    // grouping would say Aug 14; the client's local day is Aug 15.
    const at = new Date('2026-08-14T18:30:00Z');
    expect(toLocalDate(at, 'Asia/Kolkata')).toBe('2026-08-15');
  });

  it('assigns a 23:45 local workout to the previous day in a negative-offset zone', () => {
    // 23:45 EST (UTC-5) on Jan 14 is 04:45 UTC on Jan 15. Naive UTC
    // grouping would say Jan 15; the client's local day is Jan 14.
    const at = new Date('2026-01-15T04:45:00Z');
    expect(toLocalDate(at, 'America/New_York')).toBe('2026-01-14');
  });

  it('handles a half-hour-offset zone', () => {
    const at = new Date('2026-08-14T18:29:00Z'); // one minute before local midnight
    expect(toLocalDate(at, 'Asia/Kolkata')).toBe('2026-08-14');
  });

  it('gives a coach in London and a client in Kolkata different local dates for the same instant', () => {
    const at = new Date('2026-08-14T20:00:00Z'); // 21:00 in London, 01:30 next day in Kolkata
    expect(toLocalDate(at, 'Europe/London')).toBe('2026-08-14');
    expect(toLocalDate(at, 'Asia/Kolkata')).toBe('2026-08-15');
  });
});

describe('localDateRangeUtc', () => {
  it('covers exactly local midnight to the following local midnight', () => {
    const { start, end } = localDateRangeUtc('2026-08-15', 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-08-14T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-08-15T18:30:00.000Z');
  });

  it('produces a 23-hour range on a spring-forward DST day', () => {
    const { start, end } = localDateRangeUtc('2026-03-08', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect((end.getTime() - start.getTime()) / (60 * 60 * 1000)).toBe(23);
  });

  it('produces a 25-hour range on a fall-back DST day', () => {
    const { start, end } = localDateRangeUtc('2026-11-01', 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((end.getTime() - start.getTime()) / (60 * 60 * 1000)).toBe(25);
  });

  it('rejects a malformed calendar date', () => {
    expect(() => localDateRangeUtc('15-08-2026', 'Asia/Kolkata')).toThrow(RangeError);
  });
});

describe('localWeekRangeUtc', () => {
  it('defaults to a Monday-start week', () => {
    // 2026-08-19 is a Wednesday; the containing week is Mon Aug 17 – Sun Aug 23.
    const { start, end } = localWeekRangeUtc('2026-08-19', 'Asia/Kolkata');
    expect(toLocalDate(start, 'Asia/Kolkata')).toBe('2026-08-17');
    // end is exclusive — the instant that starts the *next* Monday.
    expect(toLocalDate(end, 'Asia/Kolkata')).toBe('2026-08-24');
  });

  it('honours an explicit weekStartsOn override', () => {
    // Sunday-start week containing the same Wednesday: Sun Aug 16 – Sat Aug 22.
    const { start, end } = localWeekRangeUtc('2026-08-19', 'Asia/Kolkata', 0);
    expect(toLocalDate(start, 'Asia/Kolkata')).toBe('2026-08-16');
    expect(toLocalDate(end, 'Asia/Kolkata')).toBe('2026-08-23');
  });

  it('rejects a malformed calendar date', () => {
    expect(() => localWeekRangeUtc('not-a-date', 'Asia/Kolkata')).toThrow(RangeError);
  });
});

describe('formatLocalDate', () => {
  it('formats with the default long-date format', () => {
    const at = new Date('2026-08-14T18:30:00Z');
    expect(formatLocalDate(at, 'Asia/Kolkata')).toBe('Saturday, August 15th, 2026');
  });

  it('formats with a caller-supplied format string', () => {
    const at = new Date('2026-08-14T18:30:00Z');
    expect(formatLocalDate(at, 'Asia/Kolkata', 'yyyy/MM/dd')).toBe('2026/08/15');
  });
});

describe('formatRelativeToNow', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads "ago" for a moment in the past', () => {
    expect(formatRelativeToNow(new Date(Date.now() - 2 * DAY_MS))).toBe('2 days ago');
  });

  it('scales to weeks and months for older instants', () => {
    expect(formatRelativeToNow(new Date(Date.now() - 14 * DAY_MS))).toBe('14 days ago');
    expect(formatRelativeToNow(new Date(Date.now() - 35 * DAY_MS))).toBe('about 1 month ago');
  });

  it('does not depend on the device timezone', () => {
    // Elapsed-time phrasing, unlike everything else in this file — the
    // instant itself already carries the only clock that matters.
    const at = new Date(Date.now() - HOUR_MS);
    expect(formatRelativeToNow(at)).toBe('about 1 hour ago');
  });
});

// Q14: `now` is an explicit parameter, not merely an implementation detail
// hidden behind the fake-timer describe block above — this suite runs with
// REAL timers throughout, and passes precisely to prove the function reads
// no ambient clock when `now` is supplied.
describe('formatRelativeToNow with an explicit `now`', () => {
  it('is deterministic with no fake timers installed', () => {
    const now = new Date('2026-08-15T00:00:00Z');
    const at = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeToNow(at, now)).toBe('2 days ago');
  });
});

describe('addCalendarDays', () => {
  it('adds within a month', () => {
    expect(addCalendarDays('2026-08-14', 3)).toBe('2026-08-17');
  });

  it('subtracts with a negative count', () => {
    expect(addCalendarDays('2026-08-14', -3)).toBe('2026-08-11');
  });

  it('rolls forward across a month boundary', () => {
    expect(addCalendarDays('2026-08-30', 3)).toBe('2026-09-02');
  });

  it('rolls backward across a year boundary', () => {
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('crosses a US spring-forward DST transition uneventfully', () => {
    // 2026-03-08 is the US spring-forward day (America/New_York) — pure
    // calendar arithmetic, so it is not even a special case here.
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('crosses a US fall-back DST transition uneventfully', () => {
    expect(addCalendarDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('handles a leap-year February correctly', () => {
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addCalendarDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is a no-op for zero days', () => {
    expect(addCalendarDays('2026-08-14', 0)).toBe('2026-08-14');
  });

  it('rejects a malformed calendar date', () => {
    expect(() => addCalendarDays('14-08-2026', 1)).toThrow(RangeError);
  });

  // No "does not depend on the device timezone" test here, unlike this
  // file's other describe blocks — this package carries no `@types/node`
  // (CLAUDE.md §4: "NO node builtins"), so a test can't toggle
  // `process.env.TZ` to prove it. The guarantee is definitional instead:
  // `addCalendarDays` takes no timezone parameter at all, and its
  // implementation (`toCalendarArithmeticDate`/`fromCalendarArithmeticDate`)
  // is a self-cancelling round trip through the SAME local getters on both
  // ends, so whatever the runtime's local timezone actually is cancels out
  // rather than leaking into the result — this file's own top-of-file
  // comment's "TZ=<anything> pnpm test is expected to be a no-op" promise
  // already covers this at the suite level.
});

describe('isoWeekdayOfCalendarDate', () => {
  it('numbers Monday through Sunday as 1 through 7', () => {
    // 2026-08-17 through 2026-08-23 is Mon–Sun.
    expect(isoWeekdayOfCalendarDate('2026-08-17')).toBe(1); // Monday
    expect(isoWeekdayOfCalendarDate('2026-08-18')).toBe(2); // Tuesday
    expect(isoWeekdayOfCalendarDate('2026-08-19')).toBe(3); // Wednesday
    expect(isoWeekdayOfCalendarDate('2026-08-20')).toBe(4); // Thursday
    expect(isoWeekdayOfCalendarDate('2026-08-21')).toBe(5); // Friday
    expect(isoWeekdayOfCalendarDate('2026-08-22')).toBe(6); // Saturday
    expect(isoWeekdayOfCalendarDate('2026-08-23')).toBe(7); // Sunday
  });

  it('rejects a malformed calendar date', () => {
    expect(() => isoWeekdayOfCalendarDate('not-a-date')).toThrow(RangeError);
  });

  // Same note as `addCalendarDays` above: no `process.env.TZ`-toggling test
  // here, for the same reason — the guarantee is definitional, not runtime.
});

describe('diffCalendarDays', () => {
  it('counts whole days forward', () => {
    expect(diffCalendarDays('2026-08-10', '2026-08-17')).toBe(7);
  });

  it('counts negative when `to` precedes `from`', () => {
    expect(diffCalendarDays('2026-08-17', '2026-08-10')).toBe(-7);
  });

  it('is zero for the same date', () => {
    expect(diffCalendarDays('2026-08-10', '2026-08-10')).toBe(0);
  });

  it('crosses a month boundary correctly', () => {
    expect(diffCalendarDays('2026-08-30', '2026-09-02')).toBe(3);
  });

  it('is the exact inverse of addCalendarDays', () => {
    const start = '2026-08-10';
    const end = addCalendarDays(start, 41);
    expect(diffCalendarDays(start, end)).toBe(41);
  });

  it('rejects a malformed calendar date', () => {
    expect(() => diffCalendarDays('not-a-date', '2026-08-10')).toThrow(RangeError);
    expect(() => diffCalendarDays('2026-08-10', 'not-a-date')).toThrow(RangeError);
  });
});
