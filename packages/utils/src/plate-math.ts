// Plate math — what a client actually loads on the bar, and how far the
// weight stepper moves. Both are pure formulas the logger and the API must
// agree on, so they live here (`code-conventions` §1).
//
// Kilograms in, kilograms out (`CLAUDE.md` hard rule). Nothing here knows
// `users.weight_unit` exists — `formatWeight` at the render edge does.

/** The standard gym inventory, largest first — what `calculatePlates` loads from. */
export const STANDARD_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

/** A men's Olympic bar. Callers pass their own for a 15 kg bar or a fixed-weight one. */
export const DEFAULT_BARBELL_KG = 20;

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
  if (!Number.isFinite(totalWeightKg)) {
    throw new RangeError(`Expected a finite total weight, received ${totalWeightKg}`);
  }
  if (!Number.isFinite(barbellWeightKg) || barbellWeightKg < 0) {
    throw new RangeError(`Expected a finite, non-negative bar weight, received ${barbellWeightKg}`);
  }

  // Integer centi-kg of the total — the precision the weight columns store
  // (DB§2), and the only way greedy subtraction accumulates no float error.
  let remainingCentiKg = Math.round(totalWeightKg * 100) - Math.round(barbellWeightKg * 100);
  const plates: number[] = [];

  for (const plateKg of STANDARD_PLATES_KG) {
    const pairCentiKg = plateKg * 200;
    const pairs = Math.floor(remainingCentiKg / pairCentiKg);
    if (pairs <= 0) continue;

    for (let i = 0; i < pairs; i += 1) plates.push(plateKg);
    remainingCentiKg -= pairs * pairCentiKg;
  }

  return { plates, remainder: remainingCentiKg / 100 };
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
