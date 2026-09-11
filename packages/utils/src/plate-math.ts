// Plate math — what a client actually loads on the bar, and how far the
// weight stepper moves. Both are pure formulas the logger and the API must
// agree on, so they live here (`code-conventions` §1).
//
// **Kilograms remain the storage truth** (`CLAUDE.md` §0, DB§5.1.1). What
// changed on 11 Sep 2026 is that a rack is not a unit-free thing: a gym is
// either metric or imperial, and a client in an imperial gym is not loading
// 25 kg plates. So `resolvePlateLoad` takes kilograms in and gives
// kilograms back, and picks which physical inventory to reason about in
// between. The kg↔lb edge is in this file and `./units/weight.ts` — the
// two modules of `packages/utils` allowed to hold one — and never in a
// component.

import { kgToLb, lbToKg, weightStepFor, type WeightUnit } from './units/weight.ts';

/** The standard metric inventory, largest first — what `calculatePlates` loads from. */
export const STANDARD_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** The standard US inventory, largest first — what `calculatePlatesLb` loads from. */
export const STANDARD_PLATES_LB = [45, 35, 25, 10, 5, 2.5] as const;

/** A men's Olympic bar. Callers pass their own for a 15 kg bar or a fixed-weight one. */
export const DEFAULT_BARBELL_KG = 20;

/** The imperial bar, and **not** the metric one: 45 lb is 20.41 kg, not 20. */
export const DEFAULT_BARBELL_LB = 45;

/** `exercises.default_increment_kg`'s own column default (DB§5.2). */
export const DEFAULT_INCREMENT_KG = 2.5;

export interface PlateBreakdown {
  /** Plates for **one side** of the bar, largest first. */
  plates: number[];
  /**
   * Kilograms of the **total** the inventory cannot make. `0` means exact;
   * positive means the load falls short; negative means the bare bar is
   * already heavier than the total asked for.
   */
  remainder: number;
}

/**
 * The plates for one side of the bar, loaded greedily largest-first.
 *
 * Plates are symmetric, so a pair of `p` kg plates moves the **total** by
 * `2p` — the smallest total step a standard set can make is therefore
 * 2.5 kg, and any total off that grid comes back as a `remainder` rather
 * than a confidently wrong breakdown.
 */
export function calculatePlates(totalWeightKg: number, barbellWeightKg: number): PlateBreakdown {
  // Centi-kg: the precision the weight columns store (DB§2).
  return loadBar(totalWeightKg, barbellWeightKg, STANDARD_PLATES_KG, 100);
}

/**
 * The same loader against a US rack, in pounds end to end.
 *
 * Not `calculatePlates` with a converted answer — that is the defect this
 * replaces. A pound display rounds to whole numbers (`formatWeight`), so a
 * kilogram breakdown can never round-trip back through it, and the
 * "nearest makeable weight" line never resolved.
 *
 * Plates are symmetric here too, so a pair of 2.5 lb plates moves the
 * **total** by 5 lb — the smallest step an imperial rack makes, and the
 * grid every achievable total sits on.
 */
export function calculatePlatesLb(totalWeightLb: number, barbellWeightLb: number): PlateBreakdown {
  // Deci-lb rather than whole pounds: a 2.5 lb plate is not an integer, and
  // neither would a 1.25 lb plate be if the inventory ever grew one. Its
  // *pair* always is, which is what the arithmetic below consumes.
  return loadBar(totalWeightLb, barbellWeightLb, STANDARD_PLATES_LB, 10);
}

/**
 * The one arithmetic, parameterised by rack. `scale` is the integer
 * sub-unit of the **total** the subtraction runs in; every pair of plates
 * is an exact integer number of them, which is what makes a per-side/total
 * off-by-one structurally impossible rather than merely tested for.
 */
function loadBar(
  totalWeight: number,
  barbellWeight: number,
  inventory: readonly number[],
  scale: number,
): PlateBreakdown {
  if (!Number.isFinite(totalWeight)) {
    throw new RangeError(`Expected a finite total weight, received ${totalWeight}`);
  }
  if (!Number.isFinite(barbellWeight) || barbellWeight < 0) {
    throw new RangeError(`Expected a finite, non-negative bar weight, received ${barbellWeight}`);
  }

  let remaining = Math.round(totalWeight * scale) - Math.round(barbellWeight * scale);
  const plates: number[] = [];

  for (const plate of inventory) {
    const pair = plate * scale * 2;
    const pairs = Math.floor(remaining / pair);
    if (pairs <= 0) continue;

    for (let i = 0; i < pairs; i += 1) plates.push(plate);
    remaining -= pairs * pair;
  }

  return { plates, remainder: remaining / scale };
}

/** A plate breakdown resolved against the rack the client's gym actually has. */
export interface PlateLoad {
  /** Plates for **one side**, largest first, in `plateUnit`. */
  plates: number[];
  /** The unit the plates above are expressed in — the rack, not the client's preference. */
  plateUnit: WeightUnit;
  /** The kilogram load the rack actually makes. Kilograms are still the truth. */
  achievableKg: number;
  /** Kilograms of the total the rack cannot make. Sign as {@link PlateBreakdown.remainder}. */
  remainderKg: number;
}

export interface PlateLoadInput {
  /** The weight asked for. Kilograms, always (DB§5.1.1). */
  weightKg: number;
  /** The bar being loaded, in kilograms. Defaults to the unit's own standard bar. */
  barbellWeightKg?: number | undefined;
  /** `users.weight_unit` — which physical rack this client is standing at. */
  unit: WeightUnit;
}

/**
 * Kilograms in, kilograms out, with the rack chosen by the client's unit.
 *
 * This is the whole unit edge for plate math. The imperial path quantises
 * the total **and the bar** to the pound a lb client reads, so every value
 * it returns survives the round trip back through `formatWeight` — which is
 * what makes the "nearest makeable weight" suggestion settle in one tap
 * instead of re-offering itself forever.
 *
 * Nothing here changes what gets stored: a client switching units sees the
 * same logged weights, drawn against a different rack.
 */
export function resolvePlateLoad({ weightKg, barbellWeightKg, unit }: PlateLoadInput): PlateLoad {
  if (unit === 'lb') {
    const barbellLb =
      barbellWeightKg === undefined ? DEFAULT_BARBELL_LB : Math.round(kgToLb(barbellWeightKg));
    const totalLb = Math.round(kgToLb(weightKg));
    const { plates, remainder } = calculatePlatesLb(totalLb, barbellLb);

    return {
      plates,
      plateUnit: 'lb',
      achievableKg: lbToKg(totalLb - remainder),
      remainderKg: lbToKg(remainder),
    };
  }

  const barbell = barbellWeightKg ?? DEFAULT_BARBELL_KG;
  const { plates, remainder } = calculatePlates(weightKg, barbell);

  return {
    plates,
    plateUnit: 'kg',
    // Centi-kg again, so the achievable load is not a float subtraction.
    achievableKg: Math.round((weightKg - remainder) * 100) / 100,
    remainderKg: remainder,
  };
}

/**
 * The stepper's step in the unit the client reads, composing the exercise's
 * configured increment (DB§5.2) with the unit's own native step.
 *
 * Metric: the coach's increment, unchanged. Imperial: that increment
 * carried across and quantised onto the 5 lb grid a US rack can actually
 * add, never a converted 5.5 lb. A coach's 1.25 kg micro-loading has no
 * imperial equivalent, so it lands on the 5 lb floor; their 5 kg jump
 * becomes the 10 lb one, which is a real pair of plates.
 */
export function resolveWeightStep(
  defaultIncrementKg: number | null | undefined,
  unit: WeightUnit,
): number {
  const incrementKg = resolveWeightStepKg(defaultIncrementKg);
  if (unit === 'kg') return incrementKg;

  const grid = weightStepFor('lb');
  return Math.max(grid, Math.round(kgToLb(incrementKg) / grid) * grid);
}

/**
 * The weight stepper's step, from `exercises.default_increment_kg`.
 * Defaults to 2.5 kg when the exercise sets none — and also when it sets a
 * value a stepper cannot move by, since a 0 kg step is a dead button.
 */
export function resolveWeightStepKg(defaultIncrementKg: number | null | undefined): number {
  if (defaultIncrementKg === null || defaultIncrementKg === undefined) {
    return DEFAULT_INCREMENT_KG;
  }
  if (!Number.isFinite(defaultIncrementKg) || defaultIncrementKg <= 0) {
    return DEFAULT_INCREMENT_KG;
  }
  return defaultIncrementKg;
}
