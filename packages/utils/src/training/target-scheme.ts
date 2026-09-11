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

import { formatWeight, type WeightUnit } from '../units/weight.ts';

const MULTIPLY = '×';
const SEPARATOR = ' · ';
const EN_DASH = '–';
/** `@`, the logger line's own joint — `CLAUDE.md` §8.4 writes `3×8–10 @ RPE 8`. */
const AT = '@';

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
  /**
   * Kilograms, always — the column is (DB§5.2), so this is. The unit a
   * coach or client reads it in is the second argument to every function
   * below, passed in by the screen that knows whose preference applies.
   * **This module never looks one up**: it is pure, it runs on the device
   * and on the API, and a helper that reached for a user would be neither.
   */
  targetWeightKg: number | null;
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
 * `100kg` · `225lb`. The stored kilograms rendered in the unit asked for,
 * through `formatWeight` and nothing else — one rounding rule for every
 * weight the product prints. The trailing `.0` `formatWeight` pads kg with
 * is dropped for the same reason `formatTenths` drops it from RPE: `100.0kg`
 * is not how a coach writes a load, and this line is read at 11px.
 */
export function formatWeightTarget(kg: number, unit: WeightUnit): string {
  return `${Number(formatWeight(kg, unit))}${unit}`;
}

/**
 * `RPE 8` · `RIR 2` · `65% 1RM` · `100kg`. One of the four at most — the
 * target sheet's segmented control makes them mutually exclusive and the
 * schema enforces it, so the order below is a tiebreak that should never be
 * reached rather than a precedence rule.
 *
 * `unit` is display only. It decides how the kilograms in the row are
 * spelled and never what they are.
 */
export function formatIntensity(target: ExerciseTarget, unit: WeightUnit): string | null {
  if (target.targetRpe !== null) return `RPE ${formatTenths(target.targetRpe)}`;
  if (target.targetRir !== null) return `RIR ${formatTenths(target.targetRir)}`;
  if (target.targetPercent1rm !== null) return `${formatTenths(target.targetPercent1rm)}% 1RM`;
  if (target.targetWeightKg !== null) return formatWeightTarget(target.targetWeightKg, unit);
  return null;
}

/**
 * The same value for a per-set chip, where the column is 46px wide and
 * `1RM` is the part a coach can infer (frame 1b). RPE, RIR and a weight
 * already carry their own name — a bare numeral under a rep count would
 * read as more reps.
 */
export function formatIntensityShort(target: ExerciseTarget, unit: WeightUnit): string | null {
  if (target.targetPercent1rm !== null) return `${formatTenths(target.targetPercent1rm)}%`;
  return formatIntensity(target, unit);
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
 * The scheme line: `4 × 6–8 · RPE 8 · 3010 · 90s`, or `3 × 5 · 100kg · 90s`
 * when the coach prescribed the load outright.
 *
 * Every part after the volume is optional and an absent one leaves no
 * trace — no empty segment, no dangling separator. A block with nothing
 * but sets reads `4 sets`, which is a legitimate instruction, not a
 * degraded one.
 *
 * `unit` is required rather than defaulted to `'kg'`: a default would let a
 * screen that never thought about the reader's preference show a coach on
 * pounds a number in kilograms, and be right most of the time, which is the
 * hardest kind of wrong to notice.
 */
export function formatTargetScheme(target: ExerciseTarget, unit: WeightUnit): string {
  return [
    formatVolume(target),
    formatIntensity(target, unit),
    target.tempo,
    formatRestSeconds(target.targetRestSeconds),
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(SEPARATOR);
}

/**
 * `4 × 6–8`, or `4 sets` when the block prescribes no reps. Shared by the
 * builder's scheme line and the logger's target line so the two can never
 * disagree about how a block's volume is spelled.
 */
function formatVolume(target: ExerciseTarget): string {
  const reps = formatRepRange(target.targetRepsMin, target.targetRepsMax);
  if (reps === null) return `${target.targetSets} ${target.targetSets === 1 ? 'set' : 'sets'}`;
  return `${target.targetSets} ${MULTIPLY} ${reps}`;
}

/**
 * The logger's line: `3 × 8–10 @ RPE 8` — `CLAUDE.md` §8.4's example, which
 * is what a client reads mid-set (`session-runtime/04`).
 *
 * **Not `formatTargetScheme`, deliberately.** That one is the coach's
 * builder line and carries tempo and rest as two more `·` segments. On the
 * logger the block sits above the set rows on a 393pt screen, next to a
 * "last time" half, and has to survive 200% text — so it keeps only the
 * two parts §8.4 names and joins them with `@` rather than a third `·`,
 * which is what stops the line reading as a flat list of four equal facts.
 * Tempo and rest belong to `set-entry` and the rest timer, where they are
 * acted on rather than read.
 *
 * Both lines are built from the same `formatVolume` / `formatIntensity`, so
 * a coach and their client still read identical numbers (this module's
 * header rule) — only the punctuation between them differs.
 */
export function formatLoggerTarget(target: ExerciseTarget, unit: WeightUnit): string {
  const volume = formatVolume(target);
  const intensity = formatIntensity(target, unit);
  return intensity === null ? volume : `${volume} ${AT} ${intensity}`;
}
