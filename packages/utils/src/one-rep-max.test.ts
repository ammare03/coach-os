import { NUMERIC_6_2_MAX, estimateOneRepMax } from './one-rep-max.ts';

describe('estimateOneRepMax', () => {
  it('is w × (1 + r/30) (`CLAUDE.md` §26)', () => {
    // Reference values tight enough that an approximation of Epley — a
    // rounded coefficient, or one of the rival formulas — fails here
    // rather than passing a loose tolerance.
    expect(estimateOneRepMax(100, 6)).toBe(120);
    expect(estimateOneRepMax(60, 8)).toBe(76);
    expect(estimateOneRepMax(140, 15)).toBe(210);
    expect(estimateOneRepMax(100, 3)).toBeCloseTo(110, 10);
    expect(estimateOneRepMax(100, 5)).toBeCloseTo(116.6666666667, 10);
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.3333333333, 10);
  });

  it('carries binary error the caller’s toFixed(2) absorbs', () => {
    // 100 kg × 3 lands on 110.00000000000001, not 110. Asserted rather
    // than hidden: this is why the two-decimal rounding belongs at the
    // database boundary and not in two places.
    expect(estimateOneRepMax(100, 3)).not.toBe(110);
    expect(estimateOneRepMax(100, 3)?.toFixed(2)).toBe('110.00');
    expect(estimateOneRepMax(100, 5)?.toFixed(2)).toBe('116.67');
  });

  it('returns the lifted weight for a single (`testing` skill §3)', () => {
    // Not 103.33. The task doc guessed the overshoot was standard; it is
    // not what this product wants. There is nothing to extrapolate from a
    // true single, and applying the formula anyway inflates every one of
    // them by 3.3% — straight into `personal_records` as a PR the client
    // never hit.
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(62.5, 1)).toBe(62.5);
  });

  it('leaves rounding to the caller at the database boundary', () => {
    // Pre-rounding would change the stored value: `toFixed` and a
    // ×100 round disagree on binary half-way cases.
    expect(estimateOneRepMax(102.5, 7)).toBe(102.5 * (1 + 7 / 30));
  });

  it('has nothing to estimate from without an external load', () => {
    expect(estimateOneRepMax(null, 10)).toBeNull();
    expect(estimateOneRepMax(0, 10)).toBeNull();
    expect(estimateOneRepMax(-20, 10)).toBeNull();
  });

  it('has nothing to estimate from without a completed rep', () => {
    // `reps` is `min(0)` in `packages/schemas`, so zero reaches this
    // function: a failed attempt is not a single.
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, -1)).toBeNull();
    expect(estimateOneRepMax(100, 0.5)).toBeNull();
  });

  it('declines a non-finite input rather than propagating it', () => {
    expect(estimateOneRepMax(Number.NaN, 1)).toBeNull();
    expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(estimateOneRepMax(100, Number.NaN)).toBeNull();
    expect(estimateOneRepMax(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('declines rather than overflowing numeric(6,2)', () => {
    // A value Postgres would reject with a 22003 is not an estimate worth
    // failing the client's set over.
    expect(estimateOneRepMax(9_999.99, 2)).toBeNull();
    expect(estimateOneRepMax(10_000, 1)).toBeNull();
  });

  it('accepts an estimate that lands exactly on the column ceiling', () => {
    expect(estimateOneRepMax(NUMERIC_6_2_MAX, 1)).toBe(NUMERIC_6_2_MAX);
  });
});
