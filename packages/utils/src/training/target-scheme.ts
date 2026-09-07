// The one place a `training.program_exercises` target block becomes words.
//
// **The coach's builder and the client's logger show the same string.** The
// scheme line under an exercise in the program day screen
// (`program-builder/02`, frame 1b) is character-for-character the target
// line the client reads mid-set (`phase-09-workout-logger/session-runtime/
// 04`). Two implementations would drift, and the drift would be invisible:
// the coach would be certain they had written one thing and the client
// would be reading another. That is why this is in `packages/utils` and not
// inline in either screen (`CLAUDE.md` §4 — "if a formula exists in two
// places, one of them is already wrong").
//
// Pure, no React, no I/O. Every separator is the literal the design uses:
// `×` (U+00D7), `·` (U+00B7), `–` (U+2013).

const MULTIPLY = '×';
const SEPARATOR = ' · ';
const EN_DASH = '–';

/**
 * Rest under two minutes reads in seconds (`90s`), at or over it in
 * minutes (`2m`, `2m 30s`) — which is what the rest chips already offer
 * and what a coach says out loud. A `1m 30s` for the most common rest in
 * the product would be worse on both counts.
 */
const REST_MINUTES_THRESHOLD_SECONDS = 120;
const SECONDS_PER_MINUTE = 60;

/**
 * The columns this reads, named exactly as `training.program_exercises`
 * names them. `null` throughout rather than `undefined`: this is what a
 * row looks like, and every caller is holding a row.
 */
export interface ExerciseTarget {
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetRpe: number | null;
  targetRir: number | null;
  targetPercent1rm: number | null;
  tempo: string | null;
  targetRestSeconds: number | null;
}

/**
 * `target_rpe` and `target_percent_1rm` are `numeric(_,1)`, so 8 arrives as
 * 8 and 7.5 as 7.5 — and "RPE 8.0" is not how anybody writes it. Drops the
 * decimal only when there is nothing in it.
 */
function formatTenths(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * `6–8`, or just `6` when the range has no width. `null` when the coach
 * set no reps at all — a timed carry or a stretch is a real target block
 * with no rep count in it.
 */
export function formatRepRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  // A half-set range should be impossible (DB§5.2's cross-column CHECK and
  // the schema's own `REP_RANGE_PAIR_MESSAGE` both refuse it), so the
  // surviving number is shown rather than the pair suppressed.
  if (min === null) return String(max);
  if (max === null) return String(min);
  return min === max ? String(min) : `${min}${EN_DASH}${max}`;
}

/**
 * `RPE 8` · `RIR 2` · `65% 1RM`. One of the three at most — the target
 * sheet's segmented control makes them mutually exclusive and the schema
 * enforces it, so the order below is a tiebreak that should never be
 * reached rather than a precedence rule.
 */
export function formatIntensity(target: ExerciseTarget): string | null {
  if (target.targetRpe !== null) return `RPE ${formatTenths(target.targetRpe)}`;
  if (target.targetRir !== null) return `RIR ${formatTenths(target.targetRir)}`;
  if (target.targetPercent1rm !== null) return `${formatTenths(target.targetPercent1rm)}% 1RM`;
  return null;
}

/**
 * The same value for a per-set chip, where the column is 46px wide and
 * `1RM` is the part a coach can infer (frame 1b). RPE and RIR already
 * carry their own name and are unchanged.
 */
export function formatIntensityShort(target: ExerciseTarget): string | null {
  if (target.targetPercent1rm !== null) return `${formatTenths(target.targetPercent1rm)}%`;
  return formatIntensity(target);
}

/** `45s` · `90s` · `2m` · `2m 30s`. */
export function formatRestSeconds(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < REST_MINUTES_THRESHOLD_SECONDS) return `${seconds}s`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const remainder = seconds % SECONDS_PER_MINUTE;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

/**
 * The scheme line: `4 × 6–8 · RPE 8 · 3010 · 90s`.
 *
 * Every part after the volume is optional and an absent one leaves no
 * trace — no empty segment, no dangling separator. A block with nothing
 * but sets reads `4 sets`, which is a legitimate instruction, not a
 * degraded one.
 */
export function formatTargetScheme(target: ExerciseTarget): string {
  const reps = formatRepRange(target.targetRepsMin, target.targetRepsMax);
  const volume =
    reps === null
      ? `${target.targetSets} ${target.targetSets === 1 ? 'set' : 'sets'}`
      : `${target.targetSets} ${MULTIPLY} ${reps}`;

  return [
    volume,
    formatIntensity(target),
    target.tempo,
    formatRestSeconds(target.targetRestSeconds),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(SEPARATOR);
}
