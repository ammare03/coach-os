// `phase-09-workout-logger/today-card/01` — the "~55 min" segment of the
// Today card's context line (`today-card/DESIGN-SPEC.md` §3.1, which names
// this function and this package by path).
//
// It lives here rather than in the card because the same estimate has to
// read identically wherever a prescription is shown — the card today, the
// logger's header and a coach's program preview next — and a formula that
// exists twice is already wrong once (`code-conventions` §1).
//
// Two things it deliberately is not:
//
// (a) Not stored. `workout_sessions` has no estimated-duration column and
//     must not grow one: the prescription resolves live through
//     `program_day_id` (`apps/api/src/features/programs/versioning.md`), so
//     a stored estimate would be stale the moment a coach edits the day.
//
// (b) Not precise, and rounded so it cannot pretend to be. `~57 min` claims
//     a minute of accuracy nothing here has — the working-set constant is a
//     population average and a client's own pace is unknown — so the result
//     is rounded to the nearest 5 and the UI prefixes it with `~`
//     (DESIGN-SPEC §3.1: "never a hard estimate").

/** The only two fields of a prescribed block the estimate reads. */
export interface SessionEstimateBlock {
  targetSets: number;
  /** Seconds, or null when the coach prescribed no rest — see `DEFAULT_REST_SECONDS`. */
  targetRestSeconds: number | null;
}

/**
 * Time under load for one working set, in seconds. A 6–10 rep set at a
 * moderate tempo plus setup and racking; the tempo column is not consulted
 * because most program exercises leave it null and a two-source estimate
 * that changes when a coach fills in a tempo would read as a bug.
 */
const WORKING_SECONDS_PER_SET = 45;

/** Used when a block prescribes no rest. Mid-range for hypertrophy work. */
const DEFAULT_REST_SECONDS = 90;

/** Estimates are rounded to this, so the number never claims precision it does not have. */
const ROUND_TO_MINUTES = 5;

/**
 * An estimated wall-clock duration for a prescribed session, in minutes,
 * or `null` when there is nothing to estimate from.
 *
 * `null` is a real answer and the caller must render it by **omitting the
 * segment**, never as `~— min` (DESIGN-SPEC §3.1).
 */
export function estimateSessionMinutes(blocks: readonly SessionEstimateBlock[]): number | null {
  let seconds = 0;
  for (const block of blocks) {
    if (block.targetSets <= 0) continue;
    seconds +=
      block.targetSets *
      (WORKING_SECONDS_PER_SET + (block.targetRestSeconds ?? DEFAULT_REST_SECONDS));
  }
  if (seconds <= 0) return null;

  const minutes = Math.round(seconds / 60 / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
  // A one-set session rounds to 0 at the 5-minute step, and "~0 min" is
  // worse than no segment at all.
  return minutes === 0 ? ROUND_TO_MINUTES : minutes;
}

/** Total prescribed working sets for a session — the `m` in "Set 8 of 22". */
export function totalTargetSets(blocks: readonly SessionEstimateBlock[]): number {
  return blocks.reduce((total, block) => total + Math.max(0, block.targetSets), 0);
}
