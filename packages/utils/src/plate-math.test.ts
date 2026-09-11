import {
  DEFAULT_BARBELL_KG,
  DEFAULT_INCREMENT_KG,
  STANDARD_PLATES_KG,
  calculatePlates,
  resolveWeightStepKg,
} from './plate-math.ts';

describe('calculatePlates', () => {
  it('returns no plates and no remainder for an empty bar', () => {
    expect(calculatePlates(20, 20)).toEqual({ plates: [], remainder: 0 });
  });

  it('reports a negative remainder when the bar alone is heavier than the total asked for', () => {
    // Never silently rounded to "empty bar, exact" — 15 kg is not loadable
    // on a 20 kg bar, and the sign is how the UI knows which way it missed.
    expect(calculatePlates(15, 20)).toEqual({ plates: [], remainder: -5 });
  });

  it('loads one plate per side, not one plate total', () => {
    // 60 kg = 20 kg bar + 20 kg a side. Returning [20, 20] here would be the
    // per-side-vs-total off-by-one this module exists to get right.
    expect(calculatePlates(60, 20)).toEqual({ plates: [20], remainder: 0 });
  });

  it.each([
    [70, 25],
    [60, 20],
    [50, 15],
    [40, 10],
    [30, 5],
    [25, 2.5],
    [22.5, 1.25],
  ])('makes %p kg with a single %p kg plate per side', (totalKg, plateKg) => {
    expect(calculatePlates(totalKg, 20)).toEqual({ plates: [plateKg], remainder: 0 });
  });

  it('is greedy — largest plates first, smallest last', () => {
    // 177.5 kg = 20 kg bar + 78.75 kg a side.
    expect(calculatePlates(177.5, 20)).toEqual({
      plates: [25, 25, 25, 2.5, 1.25],
      remainder: 0,
    });
  });

  it('handles a very heavy total', () => {
    // 300 kg = 20 kg bar + 140 kg a side.
    expect(calculatePlates(300, 20)).toEqual({
      plates: [25, 25, 25, 25, 25, 15],
      remainder: 0,
    });
  });

  it('flags the remainder when the total falls between 2.5 kg steps', () => {
    // The smallest pair of plates adds 2.5 kg to the total, so 61 kg is
    // 1 kg past what a standard set can make.
    expect(calculatePlates(61, 20)).toEqual({ plates: [20], remainder: 1 });
  });

  it('flags a sub-kilogram remainder on a non-integer total', () => {
    expect(calculatePlates(102.75, 20)).toEqual({
      plates: [25, 15, 1.25],
      remainder: 0.25,
    });
  });

  it('accumulates no floating-point error across many plates', () => {
    const { plates, remainder } = calculatePlates(182.5, 20);
    const perSideKg = plates.reduce((sum, plate) => sum + plate, 0);

    expect(perSideKg * 2 + 20 + remainder).toBe(182.5);
    expect(remainder).toBe(0);
  });

  it('works off a non-standard bar weight', () => {
    // A 15 kg women's bar: 55 kg is 20 kg a side.
    expect(calculatePlates(55, 15)).toEqual({ plates: [20], remainder: 0 });
  });

  it('quantises the total to the 0.01 kg the weight columns store', () => {
    expect(calculatePlates(60.004, 20)).toEqual({ plates: [20], remainder: 0 });
  });

  it('rejects a non-finite total', () => {
    expect(() => calculatePlates(Number.NaN, 20)).toThrow(RangeError);
    expect(() => calculatePlates(Number.POSITIVE_INFINITY, 20)).toThrow(RangeError);
  });

  it('rejects a non-finite bar', () => {
    expect(() => calculatePlates(100, Number.NaN)).toThrow(RangeError);
  });

  it('rejects a negative bar', () => {
    expect(() => calculatePlates(100, -20)).toThrow(RangeError);
  });

  it('exposes the standard inventory largest-first', () => {
    expect(STANDARD_PLATES_KG).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    expect(DEFAULT_BARBELL_KG).toBe(20);
  });
});

describe('resolveWeightStepKg', () => {
  it('uses the exercise increment when one is set', () => {
    expect(resolveWeightStepKg(1.25)).toBe(1.25);
    expect(resolveWeightStepKg(5)).toBe(5);
  });

  it('defaults to 2.5 kg when the exercise has no increment', () => {
    expect(resolveWeightStepKg(null)).toBe(DEFAULT_INCREMENT_KG);
    expect(resolveWeightStepKg(undefined)).toBe(2.5);
  });

  it('defaults rather than returning a step that cannot move the stepper', () => {
    expect(resolveWeightStepKg(0)).toBe(2.5);
    expect(resolveWeightStepKg(-2.5)).toBe(2.5);
    expect(resolveWeightStepKg(Number.NaN)).toBe(2.5);
  });
});
