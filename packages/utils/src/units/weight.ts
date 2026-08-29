// `account-lifecycle/08` — the entire correctness surface of the weight
// unit preference. CLAUDE.md §5.1.1's rule in code: every weight is stored
// and computed in kilograms; these four functions are the ONLY place a
// pound ever exists, and only at the two edges (a user typing a number, a
// screen rendering one). Nothing upstream of `parseWeight` or downstream
// of `formatWeight` may know units exist.
//
// Lives in `packages/utils`, not `packages/db` or the mobile app: the same
// conversion has to run identically on the device (rendering, offline) and
// the API (any weight-shaped export or report) — this package's purity
// boundary is what lets both call the same code (`numeric.ts`'s own
// comment makes the identical argument for the same reason).

export type WeightUnit = 'kg' | 'lb';

// The internationally agreed exact definition (1959, still exact today) —
// never an approximation like 2.20462. Getting this constant wrong would
// make every conversion in the product wrong by a fixed, silent amount.
const KG_PER_LB = 0.45359237;

/** Exact, full-precision — rounding is `formatWeight`'s job alone (this module's own doc comment). */
export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/** Exact, full-precision — the inverse of {@link kgToLb}. */
export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/**
 * The one place a typed number, already understood to be in `unit`, becomes
 * the kilogram value everything else in the product stores and computes.
 * Never rounds beyond IEEE 754's own precision — a caller that needs a
 * storage-ready value calls `packages/utils`' `formatNumeric` on the
 * result, at the column's own declared scale, same as any other weight
 * write (DB§2).
 */
export function parseWeight(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Expected a finite number, received ${value}`);
  }
  return unit === 'lb' ? lbToKg(value) : value;
}

/**
 * The one place a stored kilogram value becomes what a screen shows —
 * rounded for **display only** (this task's Risks section, verbatim: never
 * store or compute the rounded value). 1 decimal place in kg (a client
 * micro-loading plates cares about 62.5 vs 62.0); a whole number in lb
 * (nobody logs 225.4 lb in a US gym). Returns the numeral alone — the unit
 * label is a UI concern, composed at the call site, not baked into a
 * string this function's caller would then have to parse back apart.
 */
export function formatWeight(kg: number, unit: WeightUnit): string {
  if (!Number.isFinite(kg)) {
    throw new RangeError(`Expected a finite number, received ${kg}`);
  }
  return unit === 'lb' ? Math.round(kgToLb(kg)).toString() : kg.toFixed(1);
}

/**
 * The stepper increment, native to the unit — never a converted one
 * (this task's Risks section: 2.5 kg converted to lb is an unusable 5.5 lb
 * step). `2.5` in kg, `5` in lb — both are what a gym plate actually adds.
 */
export function weightStepFor(unit: WeightUnit): number {
  return unit === 'lb' ? 5 : 2.5;
}
