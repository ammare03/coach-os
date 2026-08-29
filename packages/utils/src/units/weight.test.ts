import { formatWeight, kgToLb, lbToKg, parseWeight, weightStepFor } from './weight.ts';

describe('kgToLb / lbToKg', () => {
  it('round-trips at full precision', () => {
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 10);
  });

  it('converts a known reference value (100 kg ≈ 220.462 lb)', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
  });

  it('converts a known reference value (225 lb ≈ 102.058 kg)', () => {
    expect(lbToKg(225)).toBeCloseTo(102.058, 3);
  });
});

describe('parseWeight', () => {
  it('passes a kg value through unchanged', () => {
    expect(parseWeight(62.5, 'kg')).toBe(62.5);
  });

  it('converts an lb value to kg at full precision', () => {
    expect(parseWeight(225, 'lb')).toBeCloseTo(102.058, 3);
  });

  it('rejects a non-finite value', () => {
    expect(() => parseWeight(Number.NaN, 'kg')).toThrow(RangeError);
    expect(() => parseWeight(Number.POSITIVE_INFINITY, 'lb')).toThrow(RangeError);
  });
});

describe('formatWeight', () => {
  it('formats kg to 1 decimal place', () => {
    expect(formatWeight(62.5, 'kg')).toBe('62.5');
    expect(formatWeight(62, 'kg')).toBe('62.0');
  });

  it('formats lb as a whole number — nobody logs 225.4 lb', () => {
    expect(formatWeight(102.058, 'lb')).toBe('225');
  });

  it('rejects a non-finite value', () => {
    expect(() => formatWeight(Number.NaN, 'kg')).toThrow(RangeError);
  });
});

// This task's own required test (`account-lifecycle/08`'s Approach step 3):
// the one that catches a rounding regression introduced years from now.
// Rounding lives ONLY in `formatWeight` (never in parseWeight, never in
// storage) — this is what that invariant actually buys: re-parsing a
// formatted value stays within the display's own rounding tolerance, for
// every realistic weight, in both units.
describe('round-trip stability (1–500 kg, both units)', () => {
  const sampleKg = Array.from({ length: 50 }, (_, i) => 1 + i * (499 / 49));

  it('kg → format → parse returns the original within formatWeight’s own 0.1 kg rounding', () => {
    for (const kg of sampleKg) {
      const roundTripped = parseWeight(Number(formatWeight(kg, 'kg')), 'kg');
      expect(Math.abs(roundTripped - kg)).toBeLessThanOrEqual(0.05);
    }
  });

  it('lb → format → parse returns the original within formatWeight’s own 1 lb rounding', () => {
    for (const kg of sampleKg) {
      const lb = kgToLb(kg);
      const roundTripped = kgToLb(parseWeight(Number(formatWeight(kg, 'lb')), 'lb'));
      expect(Math.abs(roundTripped - lb)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('weightStepFor', () => {
  it('is 2.5 for kg — a real gym plate increment, never a converted one', () => {
    expect(weightStepFor('kg')).toBe(2.5);
  });

  it('is 5 for lb — a real gym plate increment, never a converted one', () => {
    expect(weightStepFor('lb')).toBe(5);
  });
});
