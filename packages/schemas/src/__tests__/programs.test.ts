// The target block, bound by bound, against DB§5.2's own `CHECK`s
// (`program-builder/02`). Strictness and length caps are proved generically
// by `conventions.test.ts`; what is specific here is that **the schema and
// the database refuse exactly the same values**. The builder's live
// validation reads these same bounds, so a value this file accepts and
// Postgres rejects would reach a coach as an unexplained server error.
import {
  createProgramExerciseInput,
  deleteProgramExerciseInput,
  getProgramDayInput,
  PROGRAM_BOUNDS,
  REP_RANGE_ORDER_MESSAGE,
  REP_RANGE_PAIR_MESSAGE,
  reorderProgramExercisesInput,
  SINGLE_INTENSITY_MESSAGE,
  updateProgramExerciseInput,
} from '../programs.ts';

const VALID_ID = '00000000-0000-7000-8000-000000000001';
const OTHER_ID = '00000000-0000-7000-8000-000000000002';

function create(overrides: Record<string, unknown> = {}) {
  return createProgramExerciseInput.safeParse({
    programDayId: VALID_ID,
    exerciseId: OTHER_ID,
    targetSets: 4,
    targetRepsMin: 6,
    targetRepsMax: 8,
    targetRpe: 8,
    ...overrides,
  });
}

/** The first message a failed parse produced, so a test names the rule it is about. */
function firstMessage(result: ReturnType<typeof create>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('PROGRAM_BOUNDS', () => {
  // The numbers the sub-labels print. If one drifts from DB§5.2 the
  // constraint stops being guidance and becomes a wall the coach hits.
  it('carries every DB§5.2 target bound the builder prints as a sub-label', () => {
    expect(PROGRAM_BOUNDS.minTargetSets).toBe(1);
    expect(PROGRAM_BOUNDS.maxTargetSets).toBe(20);
    expect(PROGRAM_BOUNDS.minRpe).toBe(1);
    expect(PROGRAM_BOUNDS.maxRpe).toBe(10);
    expect(PROGRAM_BOUNDS.minRir).toBe(0);
    expect(PROGRAM_BOUNDS.maxRir).toBe(10);
    expect(PROGRAM_BOUNDS.minPercent1rm).toBe(1);
    expect(PROGRAM_BOUNDS.maxPercent1rm).toBe(150);
    // `numeric(6, 2)`'s own two ends, in kilograms — never a converted
    // number, and never one the sheet restates in pounds.
    expect(PROGRAM_BOUNDS.minWeightKg).toBe(0.01);
    expect(PROGRAM_BOUNDS.maxWeightKg).toBe(9999.99);
    expect(PROGRAM_BOUNDS.tempoDigits).toBe(4);
  });
});

describe('createProgramExerciseInput', () => {
  it('accepts the defaults the target sheet opens with', () => {
    expect(create().success).toBe(true);
  });

  it('accepts a block with nothing but sets — "3 sets" is a real instruction', () => {
    const parsed = createProgramExerciseInput.safeParse({
      programDayId: VALID_ID,
      exerciseId: OTHER_ID,
      targetSets: 3,
    });

    expect(parsed.success).toBe(true);
  });

  it('takes no orderIndex — position is the server’s, never the caller’s', () => {
    expect(create({ orderIndex: 1 }).success).toBe(false);
  });

  describe('target_sets — program_exercises_target_sets_check, BETWEEN 1 AND 20', () => {
    it('accepts both ends and refuses either side of them', () => {
      expect(create({ targetSets: 1 }).success).toBe(true);
      expect(create({ targetSets: 20 }).success).toBe(true);
      expect(create({ targetSets: 0 }).success).toBe(false);
      expect(create({ targetSets: 21 }).success).toBe(false);
      expect(create({ targetSets: 4.5 }).success).toBe(false);
    });
  });

  describe('the rep range — the cross-column CHECK, live', () => {
    it('refuses a top below the bottom, in the words the form shows', () => {
      const result = create({ targetRepsMin: 6, targetRepsMax: 4 });

      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(REP_RANGE_ORDER_MESSAGE);
    });

    it('accepts a range with no width', () => {
      expect(create({ targetRepsMin: 5, targetRepsMax: 5 }).success).toBe(true);
    });

    it('refuses half a range — one end without the other', () => {
      const result = create({ targetRepsMin: 6, targetRepsMax: undefined });

      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(REP_RANGE_PAIR_MESSAGE);
    });

    it('refuses zero reps — program_exercises_target_reps_min_check is > 0', () => {
      expect(create({ targetRepsMin: 0, targetRepsMax: 8 }).success).toBe(false);
    });
  });

  describe('intensity — one of the four, and only within its own bound', () => {
    it('accepts RPE at both ends and on a half step', () => {
      expect(create({ targetRpe: 1 }).success).toBe(true);
      expect(create({ targetRpe: 10 }).success).toBe(true);
      expect(create({ targetRpe: 7.5 }).success).toBe(true);
    });

    it('refuses an RPE above 10 or below 1', () => {
      expect(create({ targetRpe: 10.5 }).success).toBe(false);
      expect(create({ targetRpe: 0.5 }).success).toBe(false);
    });

    // `target_rpe` is numeric(3,1): 7.25 would be silently stored as 7.3.
    it('refuses more precision than the column can hold', () => {
      expect(create({ targetRpe: 7.25 }).success).toBe(false);
    });

    it('accepts RIR from 0 to 10 and refuses 11', () => {
      expect(create({ targetRpe: undefined, targetRir: 0 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetRir: 10 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetRir: 11 }).success).toBe(false);
    });

    it('accepts % 1RM from 1 to 150 and refuses 151', () => {
      expect(create({ targetRpe: undefined, targetPercent1rm: 1 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetPercent1rm: 150 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetPercent1rm: 151 }).success).toBe(false);
    });

    it('accepts an absolute weight across numeric(6, 2)’s whole range', () => {
      expect(create({ targetRpe: undefined, targetWeightKg: 0.01 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetWeightKg: 40 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetWeightKg: 102.06 }).success).toBe(true);
      expect(create({ targetRpe: undefined, targetWeightKg: 9999.99 }).success).toBe(true);
    });

    // The column holds four digits before the point and two after it.
    // 10000 overflows it; 100.005 would be silently stored as 100.01.
    it('refuses a weight past the column’s own precision or scale', () => {
      expect(create({ targetRpe: undefined, targetWeightKg: 10000 }).success).toBe(false);
      expect(create({ targetRpe: undefined, targetWeightKg: 100.005 }).success).toBe(false);
    });

    // Zero is what clearing the intensity means, not what a light day is.
    it('refuses a zero or negative weight', () => {
      expect(create({ targetRpe: undefined, targetWeightKg: 0 }).success).toBe(false);
      expect(create({ targetRpe: undefined, targetWeightKg: -40 }).success).toBe(false);
    });

    // The wire is kilograms and nothing else. A `weightUnit` travelling
    // beside the number is the one way a stored weight could come to mean
    // two things, so `strictObject` refuses it outright.
    it('takes no unit — every weight on this wire is kilograms', () => {
      expect(create({ targetRpe: undefined, targetWeightKg: 100, weightUnit: 'lb' }).success).toBe(
        false,
      );
    });

    it('refuses two intensities at once — the segmented control allows one', () => {
      const result = create({ targetRpe: 8, targetRir: 2 });

      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(SINGLE_INTENSITY_MESSAGE);
    });

    // Weight joins the same rule rather than sitting beside it: an
    // absolute load and a relative one prescribe the same set twice.
    it('refuses a weight alongside RPE, RIR or % 1RM', () => {
      for (const other of [{ targetRpe: 8 }, { targetRir: 2 }, { targetPercent1rm: 65 }]) {
        const result = create({ targetRpe: undefined, targetWeightKg: 100, ...other });

        expect(result.success).toBe(false);
        expect(firstMessage(result)).toBe(SINGLE_INTENSITY_MESSAGE);
      }
    });
  });

  describe('tempo — program_exercises_tempo_check, ^[0-9X]{4}$', () => {
    it('accepts four digits and the X convention', () => {
      expect(create({ tempo: '3010' }).success).toBe(true);
      expect(create({ tempo: '30X0' }).success).toBe(true);
    });

    it('refuses anything that is not exactly four of them', () => {
      expect(create({ tempo: '301' }).success).toBe(false);
      expect(create({ tempo: '30100' }).success).toBe(false);
      expect(create({ tempo: '3-1-0' }).success).toBe(false);
      expect(create({ tempo: 'abcd' }).success).toBe(false);
      expect(create({ tempo: '30x0' }).success).toBe(false);
    });
  });

  describe('rest', () => {
    it('accepts zero and the smallint ceiling, and refuses past either', () => {
      expect(create({ targetRestSeconds: 0 }).success).toBe(true);
      expect(create({ targetRestSeconds: PROGRAM_BOUNDS.maxRestSeconds }).success).toBe(true);
      expect(create({ targetRestSeconds: -1 }).success).toBe(false);
      expect(create({ targetRestSeconds: PROGRAM_BOUNDS.maxRestSeconds + 1 }).success).toBe(false);
    });
  });
});

describe('updateProgramExerciseInput', () => {
  it('is the same block, keyed on the row rather than the day', () => {
    const parsed = updateProgramExerciseInput.safeParse({
      programExerciseId: VALID_ID,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 8,
      targetRpe: 8,
      tempo: '3010',
      targetRestSeconds: 90,
      coachNotes: 'Top set first, then two back-offs at the same load.',
    });

    expect(parsed.success).toBe(true);
  });

  it('applies the same cross-field rules as create', () => {
    const result = updateProgramExerciseInput.safeParse({
      programExerciseId: VALID_ID,
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 6,
    });

    expect(result.success).toBe(false);
  });

  // Changing which exercise a block is is a delete plus an add, and
  // `alternatives` (`program-builder/05`) is how a coach offers a swap.
  it('refuses an exerciseId', () => {
    expect(
      updateProgramExerciseInput.safeParse({
        programExerciseId: VALID_ID,
        exerciseId: OTHER_ID,
        targetSets: 3,
      }).success,
    ).toBe(false);
  });
});

describe('deleteProgramExerciseInput / getProgramDayInput', () => {
  it('take one id and nothing else', () => {
    expect(deleteProgramExerciseInput.safeParse({ programExerciseId: VALID_ID }).success).toBe(
      true,
    );
    expect(getProgramDayInput.safeParse({ programDayId: VALID_ID }).success).toBe(true);
    expect(getProgramDayInput.safeParse({ programDayId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('reorderProgramExercisesInput', () => {
  const A = VALID_ID;
  const B = OTHER_ID;

  it('takes a day and its new order', () => {
    expect(
      reorderProgramExercisesInput.safeParse({ programDayId: A, orderedExerciseIds: [A, B] })
        .success,
    ).toBe(true);
  });

  // A duplicated id makes the list the right LENGTH while still not being a
  // permutation, so the server's own membership check cannot lean on length
  // alone — this is the first of the two places that is caught.
  it('refuses a list that names the same block twice', () => {
    const result = reorderProgramExercisesInput.safeParse({
      programDayId: A,
      orderedExerciseIds: [A, A],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['orderedExerciseIds']);
  });

  it('refuses an empty list, a non-uuid member, and a list past the day ceiling', () => {
    expect(
      reorderProgramExercisesInput.safeParse({ programDayId: A, orderedExerciseIds: [] }).success,
    ).toBe(false);
    expect(
      reorderProgramExercisesInput.safeParse({ programDayId: A, orderedExerciseIds: ['nope'] })
        .success,
    ).toBe(false);
    expect(
      reorderProgramExercisesInput.safeParse({
        programDayId: A,
        // Distinct ids so the length bound is what refuses this, not the
        // distinctness rule above.
        orderedExerciseIds: Array.from(
          { length: PROGRAM_BOUNDS.maxExercisesPerDay + 1 },
          (_, index) => `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
        ),
      }).success,
    ).toBe(false);
  });
});
