// The single boundary where a Postgres `numeric` column's string
// representation becomes a JS number, and back (DATABASE.md DB§11.2,
// db-package-scaffold/05). `numeric` has no binary floating-point
// representation in Postgres — that is exactly why DB§2 mandates it for
// anything a human reads (weights, macros, measurements) instead of
// `float`. Converting to a JS `number` reintroduces floating-point
// behaviour, which is unavoidable once the value needs arithmetic, but
// must happen nowhere except the two functions below.
//
// Lives in packages/utils, not packages/db: the same weight value moves
// through the API's read path and the device's offline display, and this
// package's purity boundary (no Drizzle, no Node builtins) is what lets
// both call the same code.

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function assertValidScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`scale must be a non-negative integer, received ${scale}`);
  }
}

/**
 * Converts what Drizzle returns for a `numeric` column — a string — into a
 * JS number, rounded to the column's declared scale. Rejects anything that
 * is not a plain decimal numeral (no exponent notation, no leading `+`,
 * no thousands separator) rather than accepting it silently the way a bare
 * `Number()` or `parseFloat()` would — a malformed value here means a
 * driver or schema assumption changed and the caller should find out
 * immediately, not render a wrong number.
 *
 * @param value The raw string Drizzle read for this column, e.g. `"62.50"`.
 * @param scale The column's declared scale — the `s` in `numeric(p, s)`.
 */
export function parseNumeric(value: string, scale: number): number {
  assertValidScale(scale);
  if (!NUMERIC_STRING_PATTERN.test(value)) {
    throw new RangeError(`Expected a Postgres numeric string, received "${value}"`);
  }
  // toFixed's rounding is exact for the magnitudes and scales this schema
  // uses (DB§5's numeric columns top out at a handful of digits either
  // side of the decimal point) — well inside where IEEE 754 double
  // rounding matches decimal rounding. This is also what re-clamps any
  // excess precision a prior arithmetic step introduced, per the module
  // comment above.
  return Number(Number(value).toFixed(scale));
}

/**
 * The inverse of {@link parseNumeric}: formats a JS number to the
 * fixed-precision string Drizzle expects for a write, matching the
 * column's declared scale. Never leaves a number for the driver to
 * stringify however it chooses — that is how `62.5` and `62.50` end up
 * disagreeing about what a client actually logged.
 *
 * @param value A plain JS number — already the result of {@link parseNumeric}
 *   or ordinary arithmetic on one.
 * @param scale The column's declared scale — the `s` in `numeric(p, s)`.
 */
export function formatNumeric(value: number, scale: number): string {
  assertValidScale(scale);
  if (!Number.isFinite(value)) {
    throw new RangeError(`Expected a finite number, received ${value}`);
  }
  return value.toFixed(scale);
}
