import { BACKOFF_CAP_MS, BACKOFF_FIRST_DELAY_MS, computeBackoff } from './backoff.ts';
import { MAX_ATTEMPTS } from './flush.ts';

// DB§14.4's numbers are a requirement, not guidance: 1s, 2s, 4s… capped at
// 5 minutes, ten attempts. Every one of them is asserted literally here
// rather than recomputed from the formula — a test that reimplements the
// implementation proves only that it agrees with itself.
describe('computeBackoff', () => {
  it('doubles from one second for each successive failed attempt', () => {
    expect(computeBackoff(1)).toBe(1_000);
    expect(computeBackoff(2)).toBe(2_000);
    expect(computeBackoff(3)).toBe(4_000);
    expect(computeBackoff(4)).toBe(8_000);
    expect(computeBackoff(5)).toBe(16_000);
    expect(computeBackoff(6)).toBe(32_000);
    expect(computeBackoff(7)).toBe(64_000);
    expect(computeBackoff(8)).toBe(128_000);
    expect(computeBackoff(9)).toBe(256_000);
  });

  it('caps at five minutes rather than growing without bound', () => {
    expect(BACKOFF_CAP_MS).toBe(300_000);
    expect(computeBackoff(10)).toBe(300_000);
    expect(computeBackoff(20)).toBe(300_000);
    // 2^1000 overflows to Infinity before the cap is applied — the cap has
    // to survive that, or a row rescheduled here never becomes due again.
    expect(computeBackoff(1_000)).toBe(300_000);
  });

  it('never returns less than the first delay, whatever it is handed', () => {
    expect(BACKOFF_FIRST_DELAY_MS).toBe(1_000);
    expect(computeBackoff(0)).toBe(1_000);
    expect(computeBackoff(-3)).toBe(1_000);
    expect(computeBackoff(Number.NaN)).toBe(1_000);
  });

  it('always returns a whole number of milliseconds', () => {
    for (let attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
      expect(Number.isInteger(computeBackoff(attempts))).toBe(true);
    }
  });

  it('reaches the ceiling before the curve reaches the cap', () => {
    // Not decoration: with MAX_ATTEMPTS at 10 the last delay the loop can
    // actually wait out is the 9th (256s), so the cap only binds if either
    // constant moves. This is the assertion that notices.
    expect(computeBackoff(MAX_ATTEMPTS - 1)).toBeLessThan(BACKOFF_CAP_MS);
  });
});
