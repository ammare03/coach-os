import { programs as programsSchemas } from '@coachos/schemas';
import { parseWeight, type WeightUnit } from '@coachos/utils';

import type { ProgramDayExercise } from '../api/programs.ts';
import {
  intensityControl,
  intensityValueOf,
  newTargetDraft,
  sanitiseRepsInput,
  sanitiseTempoInput,
  TEMPO_INCOMPLETE_MESSAGE,
  targetDraftFrom,
  targetDraftToInput,
  validateTargetDraft,
  withIntensityValue,
  type TargetDraft,
} from '../exercise-targets.ts';

// The live cross-field validation `program-builder/02`'s Risks section
// names: without it a coach submits `target_reps_max < target_reps_min` and
// learns about it from a server error. These tests are that rule, plus the
// second half of the same decision — the commit button says what is wrong
// rather than greying out.

function draft(overrides: Partial<TargetDraft> = {}): TargetDraft {
  return { ...newTargetDraft(), ...overrides };
}

describe('newTargetDraft', () => {
  it('arrives pre-filled, so the common case is a confirm and not a form', () => {
    expect(newTargetDraft()).toMatchObject({
      targetSets: 4,
      targetRepsMin: '6',
      targetRepsMax: '8',
      targetRestSeconds: 90,
    });
    expect(newTargetDraft().intensity).toMatchObject({ mode: 'rpe', rpe: 8 });
  });

  it('commits exactly those defaults', () => {
    expect(targetDraftToInput(newTargetDraft())).toEqual({
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8,
      targetRestSeconds: 90,
    });
  });
});

describe('validateTargetDraft — the rep range', () => {
  it('accepts a valid range and lets the button commit', () => {
    const issues = validateTargetDraft(draft());

    expect(issues.repRange).toBeNull();
    expect(issues.blockingActionLabel).toBeNull();
  });

  it('refuses a top below the bottom the moment it is typed, in the server’s own words', () => {
    const issues = validateTargetDraft(draft({ targetRepsMin: '6', targetRepsMax: '4' }));

    expect(issues.repRange).toBe(programsSchemas.REP_RANGE_ORDER_MESSAGE);
    // The urgent border goes on the field the coach can fix (frame 1c).
    expect(issues.repsMaxInvalid).toBe(true);
    expect(issues.repsMinInvalid).toBe(false);
  });

  it('degrades the commit button to an inert state that says what is wrong', () => {
    const issues = validateTargetDraft(draft({ targetRepsMin: '6', targetRepsMax: '4' }));

    expect(issues.blockingActionLabel).toBe('Fix the rep range to continue');
  });

  it('refuses half a range', () => {
    expect(validateTargetDraft(draft({ targetRepsMax: '' })).repRange).toBe(
      programsSchemas.REP_RANGE_PAIR_MESSAGE,
    );
    expect(validateTargetDraft(draft({ targetRepsMin: '' })).repRange).toBe(
      programsSchemas.REP_RANGE_PAIR_MESSAGE,
    );
  });

  it('accepts no range at all — a timed movement has no rep count', () => {
    const issues = validateTargetDraft(draft({ targetRepsMin: '', targetRepsMax: '' }));

    expect(issues.repRange).toBeNull();
    expect(issues.blockingActionLabel).toBeNull();
    expect(targetDraftToInput(draft({ targetRepsMin: '', targetRepsMax: '' }))).not.toHaveProperty(
      'targetRepsMin',
    );
  });

  it('refuses zero reps — DB§5.2 requires target_reps_min > 0', () => {
    const issues = validateTargetDraft(draft({ targetRepsMin: '0', targetRepsMax: '8' }));

    expect(issues.repsMinInvalid).toBe(true);
    expect(issues.blockingActionLabel).not.toBeNull();
  });
});

describe('validateTargetDraft — tempo', () => {
  it('accepts none at all, and all four', () => {
    expect(validateTargetDraft(draft({ tempo: ['', '', '', ''] })).tempo).toBeNull();
    expect(validateTargetDraft(draft({ tempo: ['3', '0', '1', '0'] })).tempo).toBeNull();
  });

  it('refuses a partly-filled one and says so on the button', () => {
    const issues = validateTargetDraft(draft({ tempo: ['3', '0', '', ''] }));

    expect(issues.tempo).toBe(TEMPO_INCOMPLETE_MESSAGE);
    expect(issues.blockingActionLabel).toBe('Fix the tempo to continue');
  });
});

describe('sanitiseRepsInput / sanitiseTempoInput', () => {
  it('keeps digits only in a rep field — the keystroke is refused, not reported', () => {
    expect(sanitiseRepsInput('8a')).toBe('8');
    expect(sanitiseRepsInput('-3')).toBe('3');
    expect(sanitiseRepsInput('1.5')).toBe('15');
  });

  it('keeps one digit or an upper-cased X in a tempo position', () => {
    expect(sanitiseTempoInput('3')).toBe('3');
    expect(sanitiseTempoInput('x')).toBe('X');
    expect(sanitiseTempoInput('30')).toBe('0');
    expect(sanitiseTempoInput('b')).toBe('');
  });
});

describe('intensity — one mode, one stepper, its own bound printed', () => {
  it('prints each mode’s DB§5.2 bound as the sub-label under it', () => {
    expect(intensityControl('rpe', 'kg')).toMatchObject({
      min: 1,
      max: 10,
      step: 0.5,
      boundLabel: '1–10, half steps',
    });
    expect(intensityControl('rir', 'kg')).toMatchObject({ min: 0, max: 10, boundLabel: '0–10' });
    expect(intensityControl('percent', 'kg')).toMatchObject({
      min: 1,
      max: 150,
      boundLabel: '1–150%',
    });
    expect(intensityControl('none', 'kg')).toBeNull();
  });

  // The stepper a coach touches runs in their own unit, with their own
  // plate increment — never 2.5 kg converted into an unusable 5.51 lb.
  it('gives weight the unit’s own step, and a ceiling numeric(6, 2) can hold', () => {
    expect(intensityControl('weight', 'kg')).toMatchObject({
      step: 2.5,
      precision: 1,
      min: 0.1,
      max: 9999.9,
      boundLabel: '2.5 kg steps',
      unit: 'kg',
      unitLabel: 'kilograms',
    });
    expect(intensityControl('weight', 'lb')).toMatchObject({
      step: 5,
      precision: 0,
      min: 1,
      boundLabel: '5 lb steps',
      unit: 'lb',
      unitLabel: 'pounds',
    });

    // Floored, never rounded: the pound ceiling has to convert back to
    // something the column still holds.
    const maxLb = intensityControl('weight', 'lb')?.max ?? 0;
    expect(Number(parseWeight(maxLb, 'lb').toFixed(2))).toBeLessThanOrEqual(9999.99);
  });

  it('keeps a value per mode, so switching does not propose 8% of a one-rep max', () => {
    const rpe = newTargetDraft().intensity;
    const percent = { ...rpe, mode: 'percent' as const };

    expect(intensityValueOf(rpe, 'kg')).toBe(8);
    expect(intensityValueOf(percent, 'kg')).toBe(70);
    expect(intensityValueOf(withIntensityValue(percent, 80, 'kg'), 'kg')).toBe(80);
    // The RPE the coach had is untouched by editing the percentage.
    expect(withIntensityValue(percent, 80, 'kg').rpe).toBe(8);
  });

  it('sends exactly one intensity, and none when the coach cleared it', () => {
    const rir = draft({ intensity: { mode: 'rir', rpe: 8, rir: 2, percent1rm: 70, weightKg: 60 } });
    expect(targetDraftToInput(rir)).toMatchObject({ targetRir: 2 });
    expect(targetDraftToInput(rir)).not.toHaveProperty('targetRpe');
    expect(targetDraftToInput(rir)).not.toHaveProperty('targetWeightKg');

    const weight = draft({
      intensity: { mode: 'weight', rpe: 8, rir: 2, percent1rm: 70, weightKg: 100 },
    });
    expect(targetDraftToInput(weight)).toMatchObject({ targetWeightKg: 100 });
    expect(targetDraftToInput(weight)).not.toHaveProperty('targetRpe');
    expect(targetDraftToInput(weight)).not.toHaveProperty('targetRir');
    expect(targetDraftToInput(weight)).not.toHaveProperty('targetPercent1rm');

    const none = draft({
      intensity: { mode: 'none', rpe: 8, rir: 2, percent1rm: 70, weightKg: 60 },
    });
    expect(targetDraftToInput(none)).not.toHaveProperty('targetRpe');
    expect(targetDraftToInput(none)).not.toHaveProperty('targetRir');
    expect(targetDraftToInput(none)).not.toHaveProperty('targetPercent1rm');
    expect(targetDraftToInput(none)).not.toHaveProperty('targetWeightKg');
  });
});

// CLAUDE.md's hard rule, as a test: the coach's unit decides what they type
// and read, and nothing else. Two coaches setting the same physical load
// leave the same number in `target_weight_kg`.
describe('the write path is kilograms, whatever the coach reads in', () => {
  const base = newTargetDraft().intensity;

  function committedWeight(displayValue: number, unit: WeightUnit): number | undefined {
    const intensity = withIntensityValue({ ...base, mode: 'weight' }, displayValue, unit);
    return targetDraftToInput(draft({ intensity }))?.targetWeightKg;
  }

  it('stores the same kilograms for a coach on lb and a coach on kg', () => {
    // 225 lb is 102.058… kg, which at the column's own scale is 102.06.
    expect(committedWeight(225, 'lb')).toBe(102.06);
    expect(committedWeight(102.06, 'kg')).toBe(102.06);
    expect(committedWeight(225, 'lb')).toBe(committedWeight(102.06, 'kg'));
  });

  it('rounds a converted value to the column’s own scale, so the schema accepts it', () => {
    const targetWeightKg = committedWeight(135, 'lb');

    expect(targetWeightKg).toBe(61.23);
    expect(
      programsSchemas.createProgramExerciseInput.safeParse({
        programDayId: '00000000-0000-7000-8000-000000000001',
        exerciseId: '00000000-0000-7000-8000-000000000002',
        targetSets: 3,
        targetWeightKg,
      }).success,
    ).toBe(true);
  });

  it('shows the stored kilograms back in the unit the coach reads', () => {
    const stored = { ...base, mode: 'weight' as const, weightKg: 102.06 };

    expect(intensityValueOf(stored, 'lb')).toBe(225);
    expect(intensityValueOf(stored, 'kg')).toBe(102.1);
  });
});

describe('targetDraftToInput', () => {
  it('is null while the draft is not committable — a second lock behind the button', () => {
    expect(targetDraftToInput(draft({ targetRepsMin: '9', targetRepsMax: '5' }))).toBeNull();
  });

  it('drops an empty notes field rather than writing an empty string', () => {
    expect(targetDraftToInput(draft({ coachNotes: '   ' }))).not.toHaveProperty('coachNotes');
    expect(targetDraftToInput(draft({ coachNotes: ' Push the top set. ' }))).toMatchObject({
      coachNotes: 'Push the top set.',
    });
  });

  // The schema is the same shape on the other side of the wire — anything
  // this produces must parse there, or the live validation is decorative.
  it('produces a value the shared schema accepts', () => {
    const targets = targetDraftToInput(
      draft({ tempo: ['3', '0', '1', '0'], coachNotes: 'Top set first.' }),
    );

    expect(
      programsSchemas.createProgramExerciseInput.safeParse({
        programDayId: '00000000-0000-7000-8000-000000000001',
        exerciseId: '00000000-0000-7000-8000-000000000002',
        ...targets,
      }).success,
    ).toBe(true);
  });
});

describe('targetDraftFrom', () => {
  const BLOCK: ProgramDayExercise = {
    id: 'block-1',
    exerciseId: 'exercise-1',
    orderIndex: 1,
    targetSets: 3,
    targetRepsMin: 10,
    targetRepsMax: 12,
    targetRpe: null,
    targetRir: null,
    targetPercent1rm: 65,
    targetWeightKg: null,
    targetRestSeconds: 60,
    tempo: '30X0',
    supersetGroup: null,
    coachNotes: 'Same load across.',
    exerciseName: 'Seated Leg Curl',
    exercisePrimaryMuscle: 'hamstrings',
    exerciseEquipment: 'machine',
    exerciseMovementPattern: 'squat',
    alternatives: [],
  };

  it('reopens a saved block on the mode it was written in', () => {
    const seeded = targetDraftFrom(BLOCK);

    expect(seeded).toMatchObject({
      targetSets: 3,
      targetRepsMin: '10',
      targetRepsMax: '12',
      targetRestSeconds: 60,
      coachNotes: 'Same load across.',
    });
    expect(seeded.intensity).toMatchObject({ mode: 'percent', percent1rm: 65 });
    expect(seeded.tempo).toEqual(['3', '0', 'X', '0']);
    expect(validateTargetDraft(seeded).blockingActionLabel).toBeNull();
  });

  it('round-trips a block back to the same target block', () => {
    expect(targetDraftToInput(targetDraftFrom(BLOCK))).toEqual({
      targetSets: 3,
      targetRepsMin: 10,
      targetRepsMax: 12,
      targetPercent1rm: 65,
      targetRestSeconds: 60,
      tempo: '30X0',
      coachNotes: 'Same load across.',
    });
  });

  it('lands on no intensity at all when the block carries none', () => {
    expect(targetDraftFrom({ ...BLOCK, targetPercent1rm: null }).intensity.mode).toBe('none');
  });

  // Reopening must not re-round: the draft holds the stored kilograms and
  // only a key press replaces them, so a coach on pounds who opens a block
  // and saves it untouched saves the number that was already there.
  it('reopens a weighted block on its own mode and commits it unchanged', () => {
    const weighted = { ...BLOCK, targetPercent1rm: null, targetWeightKg: 102.06 };
    const seeded = targetDraftFrom(weighted);

    expect(seeded.intensity).toMatchObject({ mode: 'weight', weightKg: 102.06 });
    expect(targetDraftToInput(seeded)?.targetWeightKg).toBe(102.06);
  });
});
