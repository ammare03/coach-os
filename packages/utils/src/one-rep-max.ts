// Estimated one-rep max — Epley, `w × (1 + r/30)` (`CLAUDE.md` §26), in
// kilograms.
//
// Two consumers, so one implementation (`code-conventions` §1): the API
// computes it on write into `set_logs.estimated_1rm_kg`
// (`phase-09-workout-logger/set-entry/01`) and the device reads and
// compares it for PR display (`personal-records/02`). A coach's stored
// number and a client's screen cannot disagree by a rule.
//
// Promoted here from `apps/api/src/features/workouts/log-set.ts`, which
// held the only copy and said it belonged here.

/** What `numeric(6, 2)` can hold — six significant digits, two after the point. */
export const NUMERIC_6_2_MAX = 9_999.99;

/**
 * Epley in kilograms, or `null` when there is nothing to estimate.
 *
 * **A single returns the weight itself, not `w × (1 + 1/30)`.** Epley
 * extrapolates from a submaximal set, and at one rep there is nothing to
 * extrapolate — the client lifted that weight for one, so that weight IS
 * the one-rep max. Applying the formula anyway inflates every true single
 * by 3.3%, handing `personal-records` a PR the client never hit. The
 * `testing` skill §3 states this case as the unit test for the rule; the
 * task doc's guess that the overshoot is standard is the reading this
 * rejects.
 *
 * `null` — never a number — when the inputs carry no estimate: a
 * bodyweight set has no external load, and a zero-rep set is a failed
 * attempt rather than a single (`reps` is `min(0)` in `packages/schemas`,
 * so zero really arrives). `null` is also the answer when the result would
 * not fit `numeric(6,2)`; a value Postgres would reject with a 22003 is
 * not worth failing the client's set over.
 *
 * **Unrounded.** The caller rounds at the database boundary with
 * `.toFixed(2)`; rounding twice can disagree on binary half-way cases, and
 * a PR comparison wants the full precision.
 */
export function estimateOneRepMax(weightKg: number | null, reps: number): number | null {
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isFinite(reps) || reps < 1) return null;

  const estimate = reps === 1 ? weightKg : weightKg * (1 + reps / 30);

  return estimate > NUMERIC_6_2_MAX ? null : estimate;
}
