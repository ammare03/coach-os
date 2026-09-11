import {
  DEFAULT_BARBELL_KG,
  DEFAULT_BARBELL_LB,
  DEFAULT_INCREMENT_KG,
  STANDARD_PLATES_KG,
  STANDARD_PLATES_LB,
  calculatePlates,
  calculatePlatesLb,
  resolvePlateLoad,
  resolveWeightStep,
  resolveWeightStepKg,
} from './plate-math.ts';
import { kgToLb, lbToKg } from './units/weight.ts';

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

describe('calculatePlatesLb', () => {
  it('returns no plates and no remainder for an empty bar', () => {
    expect(calculatePlatesLb(45, 45)).toEqual({ plates: [], remainder: 0 });
  });

  it('reports a negative remainder when the bar alone is heavier than the total asked for', () => {
    expect(calculatePlatesLb(40, 45)).toEqual({ plates: [], remainder: -5 });
  });

  it('loads one plate per side, not one plate total', () => {
    // 135 lb = 45 lb bar + 45 lb a side. The canonical first working set in
    // any US gym, and the per-side-vs-total off-by-one would show here.
    expect(calculatePlatesLb(135, 45)).toEqual({ plates: [45], remainder: 0 });
  });

  it.each([
    [135, 45],
    [115, 35],
    [95, 25],
    [65, 10],
    [55, 5],
    [50, 2.5],
  ])('makes %p lb with a single %p lb plate per side', (totalLb, plateLb) => {
    expect(calculatePlatesLb(totalLb, 45)).toEqual({ plates: [plateLb], remainder: 0 });
  });

  it('is greedy — largest plates first, smallest last', () => {
    // 180 lb = 45 lb bar + 67.5 lb a side.
    expect(calculatePlatesLb(180, 45)).toEqual({
      plates: [45, 10, 10, 2.5],
      remainder: 0,
    });
  });

  it('handles a very heavy total', () => {
    // 700 lb = 45 lb bar + 327.5 lb a side.
    expect(calculatePlatesLb(700, 45)).toEqual({
      plates: [45, 45, 45, 45, 45, 45, 45, 10, 2.5],
      remainder: 0,
    });
  });

  it('flags the remainder when the total falls between 5 lb steps', () => {
    // A pair of 2.5 lb plates is the smallest move an imperial rack makes,
    // so the total sits on a 5 lb grid and 183 lb is 3 lb past it.
    expect(calculatePlatesLb(183, 45)).toEqual({
      plates: [45, 10, 10, 2.5],
      remainder: 3,
    });
  });

  it('accumulates no floating-point error across many plates', () => {
    const { plates, remainder } = calculatePlatesLb(495, 45);
    const perSideLb = plates.reduce((sum, plate) => sum + plate, 0);

    expect(perSideLb * 2 + 45 + remainder).toBe(495);
    expect(remainder).toBe(0);
  });

  it('works off a non-standard bar weight', () => {
    // A 35 lb training bar: 125 lb is 45 lb a side.
    expect(calculatePlatesLb(125, 35)).toEqual({ plates: [45], remainder: 0 });
  });

  it('quantises the total to a tenth of a pound', () => {
    expect(calculatePlatesLb(135.04, 45)).toEqual({ plates: [45], remainder: 0 });
  });

  it('rejects a non-finite total', () => {
    expect(() => calculatePlatesLb(Number.NaN, 45)).toThrow(RangeError);
    expect(() => calculatePlatesLb(Number.POSITIVE_INFINITY, 45)).toThrow(RangeError);
  });

  it('rejects a non-finite bar', () => {
    expect(() => calculatePlatesLb(225, Number.NaN)).toThrow(RangeError);
  });

  it('rejects a negative bar', () => {
    expect(() => calculatePlatesLb(225, -45)).toThrow(RangeError);
  });

  it('exposes the standard imperial inventory largest-first', () => {
    expect(STANDARD_PLATES_LB).toEqual([45, 35, 25, 10, 5, 2.5]);
    expect(DEFAULT_BARBELL_LB).toBe(45);
  });

  it('is why the metric rack cannot serve a lb client', () => {
    // The defect, pinned. Against the metric rack 185 lb is 1.41 kg off the
    // grid, whose nearest — 82.5 kg — displays as 182 lb; 182 lb is itself
    // 0.05 kg off, which displays as "0 lb under". The suggestion offered
    // itself forever because whole-pound display cannot express the gap.
    const metric = calculatePlates(lbToKg(185), DEFAULT_BARBELL_KG);
    expect(metric.remainder).toBeCloseTo(1.41, 2);
    expect(calculatePlates(lbToKg(182), DEFAULT_BARBELL_KG).remainder).toBeCloseTo(0.05, 2);

    // The same weight on the rack that gym actually has: 45 + 25 a side.
    expect(calculatePlatesLb(185, DEFAULT_BARBELL_LB)).toEqual({
      plates: [45, 25],
      remainder: 0,
    });
  });

  it('does not share the metric bar — 45 lb is not 20 kg', () => {
    expect(lbToKg(DEFAULT_BARBELL_LB)).not.toBe(DEFAULT_BARBELL_KG);
    expect(lbToKg(DEFAULT_BARBELL_LB)).toBeCloseTo(20.41, 2);
  });
});

describe('resolvePlateLoad', () => {
  it('loads a kg client against the metric rack and the 20 kg bar', () => {
    expect(resolvePlateLoad({ weightKg: 82.5, unit: 'kg' })).toEqual({
      plates: [25, 5, 1.25],
      plateUnit: 'kg',
      achievableKg: 82.5,
      remainderKg: 0,
    });
  });

  it('honours an explicit bar on the metric path', () => {
    expect(resolvePlateLoad({ weightKg: 55, barbellWeightKg: 15, unit: 'kg' })).toEqual({
      plates: [20],
      plateUnit: 'kg',
      achievableKg: 55,
      remainderKg: 0,
    });
  });

  it('loads a lb client against the imperial rack and the 45 lb bar', () => {
    // 185 lb, the weight that used to pin the nearest line open: it is
    // 45 + 25 a side on a 45 lb bar, exactly makeable, and the metric rack
    // could never say so.
    const load = resolvePlateLoad({ weightKg: lbToKg(185), unit: 'lb' });

    expect(load.plates).toEqual([45, 25]);
    expect(load.plateUnit).toBe('lb');
    expect(load.remainderKg).toBe(0);
    expect(kgToLb(load.achievableKg)).toBeCloseTo(185, 6);
  });

  it('honours an explicit bar on the imperial path, read as whole pounds', () => {
    // A 35 lb bar, stored in kg as every bar is: 125 lb is 45 lb a side.
    const load = resolvePlateLoad({
      weightKg: lbToKg(125),
      barbellWeightKg: lbToKg(35),
      unit: 'lb',
    });

    expect(load.plates).toEqual([45]);
    expect(load.remainderKg).toBe(0);
  });

  it('reports a whole-pound shortfall a lb client can act on', () => {
    const load = resolvePlateLoad({ weightKg: lbToKg(183), unit: 'lb' });

    expect(load.plates).toEqual([45, 10, 10, 2.5]);
    expect(kgToLb(load.remainderKg)).toBeCloseTo(3, 6);
    expect(kgToLb(load.achievableKg)).toBeCloseTo(180, 6);
  });

  it('resolves a kg-prescribed weight onto the imperial grid', () => {
    // A coach programmed 82.5 kg; the client reads pounds. 82.5 kg shows as
    // 182 lb, and the nearest an imperial rack makes is 180 lb.
    const load = resolvePlateLoad({ weightKg: 82.5, unit: 'lb' });

    expect(kgToLb(load.achievableKg)).toBeCloseTo(180, 6);
    expect(kgToLb(load.remainderKg)).toBeCloseTo(2, 6);
  });

  it('settles in one step — its own suggestion is exactly makeable', () => {
    // The defect this exists to fix: the metric rack's suggestion never
    // round-tripped through whole-pound display, so the line never cleared.
    let weightKg = lbToKg(183);

    for (let tap = 0; tap < 2; tap += 1) {
      const load = resolvePlateLoad({ weightKg, unit: 'lb' });
      if (load.remainderKg === 0) break;
      // Exactly what the composer does with the suggestion: round it to the
      // pound a lb client sees, then convert back for storage.
      weightKg = lbToKg(Math.round(kgToLb(load.achievableKg)));
    }

    expect(resolvePlateLoad({ weightKg, unit: 'lb' }).remainderKg).toBe(0);
  });

  it('every achievable imperial load survives the whole-pound display round trip', () => {
    // The general form of the case above, over the range a barbell sees.
    for (let lb = 45; lb <= 500; lb += 1) {
      const load = resolvePlateLoad({ weightKg: lbToKg(lb), unit: 'lb' });
      const settledKg = lbToKg(Math.round(kgToLb(load.achievableKg)));

      expect(resolvePlateLoad({ weightKg: settledKg, unit: 'lb' }).remainderKg).toBe(0);
    }
  });

  it('reports a negative remainder below the bare bar, in either unit', () => {
    expect(resolvePlateLoad({ weightKg: 15, unit: 'kg' }).remainderKg).toBe(-5);
    expect(kgToLb(resolvePlateLoad({ weightKg: lbToKg(40), unit: 'lb' }).remainderKg)).toBeCloseTo(
      -5,
      6,
    );
  });

  it('reports a bare bar as exact, in either unit', () => {
    expect(resolvePlateLoad({ weightKg: 20, unit: 'kg' })).toMatchObject({
      plates: [],
      remainderKg: 0,
    });
    expect(resolvePlateLoad({ weightKg: lbToKg(45), unit: 'lb' })).toMatchObject({
      plates: [],
      remainderKg: 0,
    });
  });

  it('rejects a non-finite weight in either unit', () => {
    expect(() => resolvePlateLoad({ weightKg: Number.NaN, unit: 'kg' })).toThrow(RangeError);
    expect(() => resolvePlateLoad({ weightKg: Number.NaN, unit: 'lb' })).toThrow(RangeError);
  });
});

describe('resolveWeightStep', () => {
  it('is the exercise increment on the metric path', () => {
    expect(resolveWeightStep(1.25, 'kg')).toBe(1.25);
    expect(resolveWeightStep(null, 'kg')).toBe(DEFAULT_INCREMENT_KG);
  });

  it('steps 5 lb for the default 2.5 kg increment, never a converted 5.5 lb', () => {
    expect(resolveWeightStep(2.5, 'lb')).toBe(5);
    expect(resolveWeightStep(null, 'lb')).toBe(5);
  });

  it('keeps a micro-loading increment on the 5 lb grid the rack can make', () => {
    expect(resolveWeightStep(1.25, 'lb')).toBe(5);
  });

  it('carries a coach’s larger increment across, quantised to the grid', () => {
    expect(resolveWeightStep(5, 'lb')).toBe(10);
    expect(resolveWeightStep(10, 'lb')).toBe(20);
  });

  it('never returns a step below the smallest move an imperial rack makes', () => {
    expect(resolveWeightStep(0.5, 'lb')).toBe(5);
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
