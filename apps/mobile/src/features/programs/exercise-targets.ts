import { programs as programsSchemas } from '@coachos/schemas';

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
  maxRestSeconds,
  tempoDigits,
} = programsSchemas.PROGRAM_BOUNDS;

export const TARGET_BOUNDS = programsSchemas.PROGRAM_BOUNDS;

/** The four positions, in the order a coach reads a tempo. */
export const TEMPO_CAPTIONS = ['down', 'pause', 'up', 'pause'] as const;

/** `^[0-9X]{4}$` (DB§5.2), one position at a time. */
const TEMPO_CHARACTER = /^[0-9X]$/;

export const REST_PRESETS_SECONDS = [60, 90, 120, 180] as const;

export type IntensityMode = 'rpe' | 'rir' | 'percent' | 'none';

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
    intensity: { mode: 'rpe', rpe: 8, rir: 2, percent1rm: 70 },
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
  return 'none';
}

/** The stepper's own configuration for the chosen mode — bound, step, and the sub-label under it. */
export function intensityControl(mode: IntensityMode): {
  min: number;
  max: number;
  step: number;
  precision: number;
  boundLabel: string;
  accessibilityLabel: string;
} | null {
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
    case 'none':
      return null;
  }
}

export function intensityValueOf(intensity: IntensityDraft): number {
  switch (intensity.mode) {
    case 'rir':
      return intensity.rir;
    case 'percent':
      return intensity.percent1rm;
    default:
      return intensity.rpe;
  }
}

export function withIntensityValue(intensity: IntensityDraft, value: number): IntensityDraft {
  switch (intensity.mode) {
    case 'rir':
      return { ...intensity, rir: value };
    case 'percent':
      return { ...intensity, percent1rm: value };
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
  const restOutOfBounds =
    draft.targetRestSeconds !== null &&
    (draft.targetRestSeconds < 0 || draft.targetRestSeconds > maxRestSeconds);

  let blockingActionLabel: string | null = null;
  if (repRange !== null) blockingActionLabel = 'Fix the rep range to continue';
  else if (tempo !== null) blockingActionLabel = 'Fix the tempo to continue';
  else if (setsOutOfBounds) blockingActionLabel = 'Fix the set count to continue';
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
    ...(tempo.length === tempoDigits ? { tempo } : {}),
    ...(draft.targetRestSeconds !== null ? { targetRestSeconds: draft.targetRestSeconds } : {}),
    ...(notes.length > 0 ? { coachNotes: notes } : {}),
  };
}
