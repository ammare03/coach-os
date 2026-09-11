import {
  formatLoggerTarget,
  formatRepRange,
  formatWeight,
  formatWeightTarget,
  type ExerciseTarget,
  type WeightUnit,
} from '@coachos/utils';

import type { LastPerformance } from './last-performance.ts';

// Every word `components/TargetLine.tsx` says, and the only place it says
// them — kept out of the component for the reason `lib/exercise-pages.ts`
// gives about the grouping rule: copy fused into a render is copy you can
// only test by rendering, and this is the line a client reads to decide how
// much weight to put on a bar.
//
// Two registers, from the same data:
//
//   `label*`  what is printed — glyphs, tight, read at arm's length.
//   `speak*`  what VoiceOver and TalkBack say — glyphs expanded to words,
//             one utterance for the whole block (`accessibility` §2).
//
// `COPY.md` rules that bind here: nothing diagnoses or prescribes (the
// product is relaying the *coach's* prescription, which is the one
// permitted form — `product-copy` §1), nothing shames an absence
// (§CO2 — "first time logging this", never "no history" or "0 sets"), no
// exclamation marks, and **no hardcoded unit**: every weight goes through
// `packages/utils` so a client on pounds never reads a number in kilograms.

/** `COPY.md` §CO2 — an absence stated as a fact, with nothing added to it. */
export const NO_HISTORY_LABEL = 'first time logging this';

/**
 * What a failed read says. Not an error, not a retry, not an alert: the
 * target line is an optional section on a screen whose primary action is
 * logging a set (`UI-UX.md` §UX8), and a client mid-set cannot act on a
 * failed query.
 */
export const TARGET_UNAVAILABLE_LABEL = 'target unavailable';

/** The lead-in on the history half. Lowercase: it is a label, not a sentence. */
const LAST_TIME_PREFIX = 'last time:';

/**
 * `session-modifications/04` — what the line says when the client's coach
 * changed it mid-session, live (§8.9).
 *
 * Lowercase, to sit beside `last time:` rather than shout over it. It
 * attributes the change to the **coach**, which `product-copy` §1 makes the
 * one permitted form of judgement in this product — the product is relaying
 * their decision, not making one. It does not say why, and it never implies
 * the client was doing anything wrong: a coach adjusting a session live is
 * ordinary coaching, not a correction (§CO2's no-shame rule).
 */
export const LIVE_OVERRIDE_LABEL = 'coach update';

/** Its spoken form, which has to attribute in a full sentence. */
const LIVE_OVERRIDE_SENTENCE = 'Updated live by your coach.';

/** The spoken lead-in on the value the coach replaced. */
const SUPERSEDED_PREFIX = 'Previously';

/** `CLAUDE.md` §8.4 joins the two halves with this. */
const SEPARATOR = '·';

const MULTIPLY = '×';

/** `3 × 8–10 @ RPE 8` — the coach's prescription, or `null` for an ad-hoc block. */
export function labelTarget(target: ExerciseTarget | null, unit: WeightUnit): string | null {
  return target === null ? null : formatLoggerTarget(target, unit);
}

/**
 * `last time: 60kg × 9`.
 *
 * The weight is unspaced from its unit and the `×` is spaced, which is not
 * a coin toss: both come straight from `packages/utils`, where
 * `formatWeightTarget` prints `100kg` and `formatTargetScheme` prints
 * `4 × 6–8`. Matching them means the client's own history is punctuated
 * exactly like the prescription above it and like the coach's builder.
 *
 * A bodyweight set has no weight and reads `9 reps`; a loaded set with no
 * rep count reads `60kg`. `pickLastPerformance` guarantees at least one of
 * the two, so this never returns a bare prefix.
 */
export function labelLastPerformance(last: LastPerformance, unit: WeightUnit): string {
  const weight = last.weightKg === null ? null : formatWeightTarget(last.weightKg, unit);

  if (weight !== null && last.reps !== null) {
    return `${weight} ${MULTIPLY} ${String(last.reps)}`;
  }
  if (weight !== null) return weight;
  return `${String(last.reps ?? 0)} reps`;
}

/**
 * `3 × 8–10 @ RPE 8` — what the coach programmed, printed struck through
 * beside what they changed it to.
 *
 * **`null` when the two read identically**, which is the whole reason this
 * is a function rather than a second `labelTarget` call: an adjustment to
 * rest seconds does not appear on this line at all, and printing the same
 * numbers twice with an arrow between them would be worse than printing
 * them once.
 */
export function labelSupersededTarget(
  programTarget: ExerciseTarget | null,
  liveTarget: ExerciseTarget | null,
  unit: WeightUnit,
): string | null {
  if (programTarget === null || liveTarget === null) return null;
  const before = formatLoggerTarget(programTarget, unit);
  return before === formatLoggerTarget(liveTarget, unit) ? null : before;
}

/** The `·` between the halves, printed only when there is a half on each side. */
export function targetSeparator(hasTarget: boolean, hasHistory: boolean): string | null {
  return hasTarget && hasHistory ? SEPARATOR : null;
}

/** The `last time:` lead-in, so the component never spells it. */
export function lastTimePrefix(): string {
  return LAST_TIME_PREFIX;
}

/**
 * The whole block as one utterance.
 *
 * Glyphs become words — `×` is "sets of" in a prescription and "for" in a
 * result, `–` is "to", `kg` is "kilograms" — because a screen reader reads
 * `3 × 8–10` as something between "three times eight ten" and nothing at
 * all, and this is the one line where a misread is a client putting the
 * wrong weight on a bar (`accessibility` §8).
 */
export function speakTargetLine(
  target: ExerciseTarget | null,
  last: LastPerformance | null,
  unit: WeightUnit,
  options: {
    unavailable?: boolean;
    /** `session-modifications/04` — the coach changed this one, live. */
    isLiveOverridden?: boolean;
    /** What they changed it from, or `null` when the line reads the same. */
    supersededTarget?: ExerciseTarget | null;
  } = {},
): string {
  if (target === null && last === null && options.unavailable === true) {
    return 'Target unavailable.';
  }

  const sentences: string[] = [];
  // Attribution first: a client hears the start of the utterance and stops
  // listening, so the fact that these are not the programmed numbers has to
  // arrive before the numbers do.
  if (options.isLiveOverridden === true) sentences.push(LIVE_OVERRIDE_SENTENCE);
  if (target !== null) sentences.push(`Target: ${speakTarget(target, unit)}.`);
  if (options.supersededTarget != null) {
    sentences.push(`${SUPERSEDED_PREFIX} ${speakTarget(options.supersededTarget, unit)}.`);
  }
  sentences.push(
    last === null
      ? 'First time logging this exercise.'
      : `Last time: ${speakLastPerformance(last, unit)}.`,
  );

  return sentences.join(' ');
}

function speakTarget(target: ExerciseTarget, unit: WeightUnit): string {
  const reps = formatRepRange(target.targetRepsMin, target.targetRepsMax);
  const sets = `${String(target.targetSets)} ${target.targetSets === 1 ? 'set' : 'sets'}`;
  const volume = reps === null ? sets : `${sets} of ${reps.replace('–', ' to ')} reps`;

  const intensity = speakIntensity(target, unit);
  return intensity === null ? volume : `${volume} at ${intensity}`;
}

/**
 * Mirrors `formatIntensity`'s precedence exactly — the schema makes the four
 * mutually exclusive, so a divergence here would be silent rather than
 * contradictory, which is worse.
 */
function speakIntensity(target: ExerciseTarget, unit: WeightUnit): string | null {
  if (target.targetRpe !== null) return `RPE ${String(target.targetRpe)}`;
  if (target.targetRir !== null) return `${String(target.targetRir)} reps in reserve`;
  if (target.targetPercent1rm !== null) {
    return `${String(target.targetPercent1rm)} percent of one rep max`;
  }
  if (target.targetWeightKg !== null) return speakWeight(target.targetWeightKg, unit);
  return null;
}

function speakLastPerformance(last: LastPerformance, unit: WeightUnit): string {
  const weight = last.weightKg === null ? null : speakWeight(last.weightKg, unit);

  if (weight !== null && last.reps !== null) {
    return `${weight} for ${String(last.reps)} ${last.reps === 1 ? 'rep' : 'reps'}`;
  }
  if (weight !== null) return weight;
  const reps = last.reps ?? 0;
  return `${String(reps)} ${reps === 1 ? 'rep' : 'reps'}`;
}

/**
 * `60 kilograms` · `135 pounds`. The numeral rounds exactly as the printed one does.
 *
 * Exported for `pr-celebration.ts`, which says the same thing about a
 * record's value — one spoken form for a weight in this feature, never two
 * that round or pluralise differently.
 */
export function speakWeight(kg: number, unit: WeightUnit): string {
  const value = Number(formatWeight(kg, unit));
  const noun = unit === 'kg' ? 'kilogram' : 'pound';
  return `${String(value)} ${value === 1 ? noun : `${noun}s`}`;
}
