// Every "recent" date this seed writes (a session's `scheduled_date`, a
// meal's `logged_date`, a check-in's `period_end`, …) is computed relative
// to a single anchor rather than `new Date()`. Anchoring to the real
// wall-clock would make `pnpm db:seed` produce a different dataset every
// day it's run — a `scheduled_date` of "today - 7" is a different literal
// date on Tuesday than it is a week later — which directly breaks DB§21's
// "byte-identical across machines" requirement the moment two runs happen
// on different days (exactly the shape of comparison
// `db-package-scaffold/04`'s CI cycle and this task's own verification
// step run). Pinning this anchor is as load-bearing for determinism as
// `faker.seed(42)` or `seedId` (deterministic-id.ts) — all three exist for
// the same reason.
export const SEED_ANCHOR_DATE = new Date('2026-08-15T00:00:00.000Z');

/** `SEED_ANCHOR_DATE` minus (or plus, for a negative input) `days`, as a Date. */
export function daysFromAnchor(days: number): Date {
  const result = new Date(SEED_ANCHOR_DATE);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** `YYYY-MM-DD`, the string form every `date` column in this schema expects. */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `daysFromAnchor(days)` formatted as `YYYY-MM-DD`. */
export function dateStringFromAnchor(days: number): string {
  return toDateString(daysFromAnchor(days));
}

/** A `timestamptz` at a specific hour/minute on `daysFromAnchor(days)`, UTC. */
export function timestampFromAnchor(days: number, hour: number, minute = 0): Date {
  const result = daysFromAnchor(days);
  result.setUTCHours(hour, minute, 0, 0);
  return result;
}
