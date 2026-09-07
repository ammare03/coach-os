import { programs as programsSchemas } from '@coachos/schemas';
import {
  formatNumeric,
  formatWeight,
  kgToLb,
  parseNumeric,
  parseWeight,
  weightStepFor,
  type WeightUnit,
} from '@coachos/utils';

import type { ProgramDayExercise } from './api/programs.ts';

// The target sheet's draft state and its live validation
// (`program-builder/02`, frame 1c). Pure — no React, no tRPC — so the rule
// a coach feels while typing is the rule a test can hold still.
//
// **Every bound here is read from `PROGRAM_BOUNDS`, never restated.** The
// sub-labels the sheet prints ("1–20", "1–10, half steps") and the checks
// that refuse a value are the same numbers by construction; a schema bound
// that moved without the sub-label following it would turn guidance back
// into a wall.

const {
  minTargetSets,
  maxTargetSets,
  minReps,
  maxReps,
  minRpe,
  maxRpe,
  rpeStep,
  minRir,
  maxRir,
  rirStep,
  minPercent1rm,
  maxPercent1rm,
  percent1rmStep,
  minWeightKg,
  maxWeightKg,
  maxRestSeconds,
  tempoDigits,
} = programsSchemas.PROGRAM_BOUNDS;

/**
 * The `s` in `numeric(6, 2)`, the scale `target_weight_kg` is declared at
 * (DB§5.2) and the one this file rounds a converted pound value to before
 * it ever reaches the draft. Without it a coach on pounds typing 225 would
 * hold 102.05828325 kg, which the shared schema refuses — the column can
 * hold two decimals and the check is `multipleOf(0.01)`.
 */
const WEIGHT_SCALE = 2;

export const TARGET_BOUNDS = programsSchemas.PROGRAM_BOUNDS;

/** The four positions, in the order a coach reads a tempo. */
export const TEMPO_CAPTIONS = ['down', 'pause', 'up', 'pause'] as const;

/** `^[0-9X]{4}$` (DB§5.2), one position at a time. */
const TEMPO_CHARACTER = /^[0-9X]$/;

export const REST_PRESETS_SECONDS = [60, 90, 120, 180] as const;

export type IntensityMode = 'rpe' | 'rir' | 'percent' | 'weight' | 'none';

/**
 * The four the segmented control offers. `'none'` is not one of them — it
 * is the control with nothing selected, reached by tapping the highlighted
 * segment again, because "no intensity" is the absence of a prescription
 * and no segment should claim it (`program-builder/02`, frame 1c, amended:
 * the fourth segment is **Weight**, and it replaced `None`).
 */
export type IntensitySegment = Exclude<IntensityMode, 'none'>;

/**
 * One value per mode rather than one shared number: switching from RPE 8
 * to % 1RM must not propose 8% of a one-rep max. Switching back returns the
 * coach to what they had, which is what makes the segmented control safe
 * to explore.
 */
export interface IntensityDraft {
  mode: IntensityMode;
  rpe: number;
  rir: number;
  percent1rm: number;
  /**
   * **Kilograms, and the only weight this draft holds.** The stepper the
   * coach touches runs in `users.weight_unit`; `intensityValueOf` converts
   * out of this field for display and `withIntensityValue` converts back
   * into it, both through `packages/utils`. Holding the kilograms rather
   * than the displayed number is what keeps reopening a block on pounds
   * and saving it untouched from quietly re-rounding what is stored
   * (`CLAUDE.md` §0 — every weight is stored in kilograms).
   */
  weightKg: number;
}

/**
 * Reps and tempo are held as the strings the fields actually contain —
 * "" is a state a coach passes through on the way to a number, and
 * modelling it as `0` would either refuse a keystroke or invent a value.
 */
export interface TargetDraft {
  targetSets: number;
  targetRepsMin: string;
  targetRepsMax: string;
  intensity: IntensityDraft;
  tempo: readonly [string, string, string, string];
  targetRestSeconds: number | null;
  coachNotes: string;
}

const EMPTY_TEMPO = ['', '', '', ''] as const;

/**
 * The common case arrives filled in, so adding an exercise is a confirm
 * rather than a form: four sets of six to eight at RPE 8, ninety seconds
 * between them (frame 1c's own opening state). A coach who wants exactly
 * that taps once.
 */
export function newTargetDraft(): TargetDraft {
  return {
    targetSets: 4,
    targetRepsMin: '6',
    targetRepsMax: '8',
    intensity: { mode: 'rpe', rpe: 8, rir: 2, percent1rm: 70, weightKg: 60 },
    tempo: EMPTY_TEMPO,
    targetRestSeconds: 90,
    coachNotes: '',
  };
}

/** The same draft, seeded from a block the coach is reopening. */
export function targetDraftFrom(block: ProgramDayExercise): TargetDraft {
  const defaults = newTargetDraft();
  const tempo = block.tempo ?? '';
  return {
    targetSets: block.targetSets,
    targetRepsMin: block.targetRepsMin === null ? '' : String(block.targetRepsMin),
    targetRepsMax: block.targetRepsMax === null ? '' : String(block.targetRepsMax),
    intensity: {
      mode: intensityModeOf(block),
      rpe: block.targetRpe ?? defaults.intensity.rpe,
      rir: block.targetRir ?? defaults.intensity.rir,
      percent1rm: block.targetPercent1rm ?? defaults.intensity.percent1rm,
      weightKg: block.targetWeightKg ?? defaults.intensity.weightKg,
    },
    tempo: [tempo[0] ?? '', tempo[1] ?? '', tempo[2] ?? '', tempo[3] ?? ''],
    targetRestSeconds: block.targetRestSeconds,
    coachNotes: block.coachNotes ?? '',
  };
}

function intensityModeOf(block: ProgramDayExercise): IntensityMode {
  if (block.targetRpe !== null) return 'rpe';
  if (block.targetRir !== null) return 'rir';
  if (block.targetPercent1rm !== null) return 'percent';
  if (block.targetWeightKg !== null) return 'weight';
  return 'none';
}

/** Decimal places in a step — 1 for kg's 2.5, 0 for lb's 5. */
function decimalsIn(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * A stored kilogram value in the coach's own unit, unrounded.
 * `formatWeight` is the rounded, display-ready form of exactly this, and is
 * what the sheet actually shows — this exists only to place the bounds,
 * which have to be floored rather than rounded (below).
 */
function inDisplayUnit(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kgToLb(kg) : kg;
}

/** The largest value the stepper may reach, never rounded UP past what the column holds. */
function floorTo(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.floor(value * scale) / scale;
}

export interface IntensityControl {
  min: number;
  max: number;
  step: number;
  precision: number;
  boundLabel: string;
  accessibilityLabel: string;
  /** Rendered beside the numeral, and spoken as `unitLabel` — weight only. */
  unit?: WeightUnit;
  unitLabel?: string;
}

/**
 * The stepper's own configuration for the chosen mode — bound, step, and
 * the sub-label under it. `unit` is the coach's display preference and
 * matters to exactly one mode; the other three are unitless numbers and
 * ignore it.
 */
export function intensityControl(mode: IntensityMode, unit: WeightUnit): IntensityControl | null {
  switch (mode) {
    case 'rpe':
      return {
        min: minRpe,
        max: maxRpe,
        step: rpeStep,
        precision: 1,
        boundLabel: `${minRpe}–${maxRpe}, half steps`,
        accessibilityLabel: 'RPE',
      };
    case 'rir':
      return {
        min: minRir,
        max: maxRir,
        step: rirStep,
        precision: 0,
        boundLabel: `${minRir}–${maxRir}`,
        accessibilityLabel: 'reps in reserve',
      };
    case 'percent':
      return {
        min: minPercent1rm,
        max: maxPercent1rm,
        step: percent1rmStep,
        precision: 0,
        boundLabel: `${minPercent1rm}–${maxPercent1rm}%`,
        accessibilityLabel: 'percent of one-rep max',
      };
    case 'weight': {
      // The step is the unit's own plate increment, never a converted one
      // (`weightStepFor`), and the precision falls out of it: 1 decimal in
      // kg, none in lb — which is exactly the scale `formatWeight` prints
      // at, so the stepper and every other weight in the product round the
      // same way. 2.5 kg is expressible; 62.5 kg is a real prescription.
      const step = weightStepFor(unit);
      const precision = decimalsIn(step);
      return {
        // The smallest positive number this unit shows. Zero is not a
        // light prescription, it is no prescription — clearing the
        // intensity is what says that.
        min: 10 ** -precision,
        // Floored, never rounded: `numeric(6, 2)` stops at 9999.99 kg and
        // a rounded ceiling would let the stepper reach a value the
        // column cannot hold.
        max: floorTo(inDisplayUnit(maxWeightKg, unit), precision),
        step,
        precision,
        // The ceiling here is four orders of magnitude past anything a
        // human loads, so printing it would be noise where the other three
        // modes print guidance. What a coach actually needs to know before
        // touching the keys is the unit they are typing in and how far one
        // press moves — so that is what the sub-label says.
        boundLabel: `${step} ${unit} steps`,
        accessibilityLabel: 'weight',
        unit,
        unitLabel: unit === 'lb' ? 'pounds' : 'kilograms',
      };
    }
    case 'none':
      return null;
  }
}

/**
 * The number the stepper shows for the chosen mode. Weight is the only one
 * that is not already in its display form: it is stored in kilograms and
 * rendered through `formatWeight`, the single rounding rule every weight
 * in the product goes through.
 */
export function intensityValueOf(intensity: IntensityDraft, unit: WeightUnit): number {
  switch (intensity.mode) {
    case 'rir':
      return intensity.rir;
    case 'percent':
      return intensity.percent1rm;
    case 'weight':
      return Number(formatWeight(intensity.weightKg, unit));
    default:
      return intensity.rpe;
  }
}

/**
 * The inverse: what the stepper emitted, understood to be in `unit`, put
 * back into the draft. **This is the only place a pound becomes a stored
 * kilogram in the builder** — through `parseWeight`, rounded once to the
 * column's own scale so the value the schema checks is the value Postgres
 * keeps.
 */
export function withIntensityValue(
  intensity: IntensityDraft,
  value: number,
  unit: WeightUnit,
): IntensityDraft {
  switch (intensity.mode) {
    case 'rir':
      return { ...intensity, rir: value };
    case 'percent':
      return { ...intensity, percent1rm: value };
    case 'weight':
      return {
        ...intensity,
        weightKg: parseNumeric(formatNumeric(parseWeight(value, unit), WEIGHT_SCALE), WEIGHT_SCALE),
      };
    default:
      return { ...intensity, rpe: value };
  }
}

/** Digits only — the field refuses the keystroke rather than reporting it afterwards. */
export function sanitiseRepsInput(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, String(maxReps).length);
}

/** One tempo position: a digit or an `X`, upper-cased, never more than one character. */
export function sanitiseTempoInput(text: string): string {
  const last = text.slice(-1).toUpperCase();
  return TEMPO_CHARACTER.test(last) ? last : '';
}

export const TEMPO_INCOMPLETE_MESSAGE = 'A tempo needs all four numbers.';
/**
 * The one line the sheet prints about how to prescribe nothing. The
 * gesture — tapping the highlighted segment again — is the natural one,
 * and it is also invisible, so it is written down rather than left to be
 * discovered (`program-builder/02`'s own rule: print the constraint before
 * the coach reaches it).
 */
export const INTENSITY_CLEAR_HINT = 'Tap the highlighted option again to clear it.';
export const SETS_BOUND_MESSAGE = `Sets run from ${minTargetSets} to ${maxTargetSets}.`;
export const REPS_BOUND_MESSAGE = `Reps start at ${minReps}.`;

/**
 * What the sheet renders, and what the commit button says when it cannot
 * commit. `blockingActionLabel` is the whole of `program-builder/02`'s
 * decision 4: **the button never greys out silently.** A disabled control
 * with no explanation makes the coach hunt for what they did wrong; a
 * button that reads "Fix the rep range to continue" points at it.
 */
export interface TargetDraftIssues {
  repRange: string | null;
  repsMinInvalid: boolean;
  repsMaxInvalid: boolean;
  tempo: string | null;
  blockingActionLabel: string | null;
}

function parseReps(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

export function validateTargetDraft(draft: TargetDraft): TargetDraftIssues {
  const min = parseReps(draft.targetRepsMin);
  const max = parseReps(draft.targetRepsMax);

  let repRange: string | null = null;
  let repsMinInvalid = false;
  let repsMaxInvalid = false;

  if ((min === null) !== (max === null)) {
    repRange = programsSchemas.REP_RANGE_PAIR_MESSAGE;
    repsMinInvalid = min === null;
    repsMaxInvalid = max === null;
  } else if (min !== null && max !== null) {
    if (min < minReps || min > maxReps) {
      repRange = REPS_BOUND_MESSAGE;
      repsMinInvalid = true;
    } else if (max < minReps || max > maxReps) {
      repRange = REPS_BOUND_MESSAGE;
      repsMaxInvalid = true;
    } else if (max < min) {
      // The urgent border goes on the field the coach can fix, not on both
      // (frame 1c): the bottom of the range is the number they meant.
      repRange = programsSchemas.REP_RANGE_ORDER_MESSAGE;
      repsMaxInvalid = true;
    }
  }

  const filledTempo = draft.tempo.filter((position) => position !== '').length;
  const tempo = filledTempo > 0 && filledTempo < tempoDigits ? TEMPO_INCOMPLETE_MESSAGE : null;

  const setsOutOfBounds = draft.targetSets < minTargetSets || draft.targetSets > maxTargetSets;
  // The stepper clamps to both ends, so this is the backstop for a draft
  // seeded from a row written before a bound moved — not a state the coach
  // can type their way into.
  const weightOutOfBounds =
    draft.intensity.mode === 'weight' &&
    (draft.intensity.weightKg < minWeightKg || draft.intensity.weightKg > maxWeightKg);
  const restOutOfBounds =
    draft.targetRestSeconds !== null &&
    (draft.targetRestSeconds < 0 || draft.targetRestSeconds > maxRestSeconds);

  let blockingActionLabel: string | null = null;
  if (repRange !== null) blockingActionLabel = 'Fix the rep range to continue';
  else if (tempo !== null) blockingActionLabel = 'Fix the tempo to continue';
  else if (setsOutOfBounds) blockingActionLabel = 'Fix the set count to continue';
  else if (weightOutOfBounds) blockingActionLabel = 'Fix the weight to continue';
  else if (restOutOfBounds) blockingActionLabel = 'Fix the rest to continue';

  return { repRange, repsMinInvalid, repsMaxInvalid, tempo, blockingActionLabel };
}

/**
 * The target block, in the shape `programs.exercises.*` accepts. `null`
 * when the draft is not committable — the caller is holding the same
 * `validateTargetDraft` result and has already said so on screen, so this
 * returning `null` is a second lock rather than the message.
 */
export function targetDraftToInput(draft: TargetDraft): {
  targetSets: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetRpe?: number;
  targetRir?: number;
  targetPercent1rm?: number;
  /** Kilograms. No unit travels beside it — see `IntensityDraft.weightKg`. */
  targetWeightKg?: number;
  tempo?: string;
  targetRestSeconds?: number;
  coachNotes?: string;
} | null {
  if (validateTargetDraft(draft).blockingActionLabel !== null) return null;

  const min = parseReps(draft.targetRepsMin);
  const max = parseReps(draft.targetRepsMax);
  const tempo = draft.tempo.join('');
  const notes = draft.coachNotes.trim();

  return {
    targetSets: draft.targetSets,
    ...(min !== null && max !== null ? { targetRepsMin: min, targetRepsMax: max } : {}),
    ...(draft.intensity.mode === 'rpe' ? { targetRpe: draft.intensity.rpe } : {}),
    ...(draft.intensity.mode === 'rir' ? { targetRir: draft.intensity.rir } : {}),
    ...(draft.intensity.mode === 'percent' ? { targetPercent1rm: draft.intensity.percent1rm } : {}),
    // Already kilograms, already at the column's scale — the conversion
    // happened once, in `withIntensityValue`, at the moment the coach
    // pressed a key. Nothing about `users.weight_unit` reaches this shape.
    ...(draft.intensity.mode === 'weight' ? { targetWeightKg: draft.intensity.weightKg } : {}),
    ...(tempo.length === tempoDigits ? { tempo } : {}),
    ...(draft.targetRestSeconds !== null ? { targetRestSeconds: draft.targetRestSeconds } : {}),
    ...(notes.length > 0 ? { coachNotes: notes } : {}),
  };
}
