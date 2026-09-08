import { formatQueuedAt } from '../queued-at.ts';

// Local calendar days, not 24-hour blocks — `CLAUDE.md` §25.5's named
// pitfall. Nothing that `toLocaleTimeString`/`toLocaleDateString` arranges
// is asserted verbatim: pinning it would test the runtime's ICU data rather
// than this function, and the machine that runs the suite is not the one
// whose locale the product follows.
describe('formatQueuedAt', () => {
  const at = (y: number, m: number, d: number, h: number, min = 0) =>
    new Date(y, m - 1, d, h, min).getTime();

  it('says Today for anything earlier the same local day', () => {
    expect(formatQueuedAt(at(2026, 9, 8, 6, 42), at(2026, 9, 8, 23, 30))).toMatch(/^Today, /);
  });

  it('says Yesterday across a local midnight, however few minutes apart', () => {
    // 23:58 read at 00:04 is six minutes ago and still yesterday. A
    // duration-based answer would call this "Today".
    expect(formatQueuedAt(at(2026, 9, 7, 23, 58), at(2026, 9, 8, 0, 4))).toMatch(/^Yesterday, /);
  });

  it('names the weekday within the past week', () => {
    // 2026-09-08 is a Tuesday, so three days earlier is a Saturday.
    expect(formatQueuedAt(at(2026, 9, 5, 18, 0), at(2026, 9, 8, 9, 0))).toMatch(/^Saturday, /);
  });

  it('falls back to a date beyond a week', () => {
    const label = formatQueuedAt(at(2026, 8, 12, 18, 0), at(2026, 9, 8, 9, 0));
    // Day/month ORDER is the locale's business — "12 Aug" here, "Aug 12" on
    // CI's en-US — so it is asserted the same way the time half is: by what
    // the label must say, not by how ICU arranges it.
    expect(label).not.toMatch(/^(Today|Yesterday|Saturday), /);
    expect(label).toMatch(/\b12\b/);
    expect(label).toMatch(/\bAug/);
  });

  it('never reads as being in the future when a clock has drifted backwards', () => {
    expect(formatQueuedAt(at(2026, 9, 9, 9, 0), at(2026, 9, 8, 9, 0))).toMatch(/^Today, /);
  });
});
