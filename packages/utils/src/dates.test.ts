// These tests must pass identically no matter what timezone the machine
// running them is in — see this package's plan task, Verification. Every
// case below names its timezone explicitly and never touches the local
// clock, so `TZ=<anything> pnpm test` is expected to be a no-op on the
// results.
import { formatLocalDate, localDateRangeUtc, localWeekRangeUtc, toLocalDate } from './dates.ts';

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
