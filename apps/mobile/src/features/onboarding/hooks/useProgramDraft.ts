// `phase-06-onboarding/coach-onboarding/03` — the draft half of the program
// step. Every edit goes to the persisted store and nothing else; the single
// server write happens when the flow advances past the step, exactly as
// step 2's does.
import { useCoachOnboardingStore, type ProgramExerciseDraft } from '../coach-store.ts';

/**
 * `DESIGN.md`-free defaults a coach can change on the card: three sets of
 * eight-to-twelve is the least surprising starting point for a general
 * program, and the alternative — asking for sets and reps inside the
 * picker, per exercise — is what turns a twenty-second task into a
 * two-minute one.
 */
export const DEFAULT_TARGET_SETS = 3;
export const DEFAULT_TARGET_REPS_MIN = 8;
export const DEFAULT_TARGET_REPS_MAX = 12;

/**
 * One exercise coming back from the picker. `exerciseId`, not `id`: this is
 * a reference to a `training.exercises` row, not a row of its own, and
 * naming it so keeps the two from being confused at a call site.
 */
export interface AddedExercise {
  exerciseId: string;
  name: string;
}

export function useProgramDraft() {
  const programName = useCoachOnboardingStore((state) => state.fields.programName);
  const days = useCoachOnboardingStore((state) => state.fields.programDays);
  const updateField = useCoachOnboardingStore((state) => state.updateField);

  function setProgramName(value: string) {
    updateField('programName', value);
  }

  function renameDay(dayIndex: number, name: string) {
    updateField(
      'programDays',
      days.map((day, index) => (index === dayIndex ? { ...day, name } : day)),
    );
  }

  /** Appends in the order they were picked, skipping any already on that day. */
  function addExercises(dayIndex: number, added: readonly AddedExercise[]) {
    updateField(
      'programDays',
      days.map((day, index) => {
        if (index !== dayIndex) return day;
        const existing = new Set(day.exercises.map((exercise) => exercise.exerciseId));
        const additions: ProgramExerciseDraft[] = added
          .filter((exercise) => !existing.has(exercise.exerciseId))
          .map((exercise) => ({
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.name,
            targetSets: DEFAULT_TARGET_SETS,
            targetRepsMin: DEFAULT_TARGET_REPS_MIN,
            targetRepsMax: DEFAULT_TARGET_REPS_MAX,
          }));
        return { ...day, exercises: [...day.exercises, ...additions] };
      }),
    );
  }

  function removeExercise(dayIndex: number, exerciseId: string) {
    updateField(
      'programDays',
      days.map((day, index) =>
        index === dayIndex
          ? { ...day, exercises: day.exercises.filter((e) => e.exerciseId !== exerciseId) }
          : day,
      ),
    );
  }

  function setTargetSets(dayIndex: number, exerciseId: string, targetSets: number) {
    updateField(
      'programDays',
      days.map((day, index) =>
        index === dayIndex
          ? {
              ...day,
              exercises: day.exercises.map((e) =>
                e.exerciseId === exerciseId ? { ...e, targetSets } : e,
              ),
            }
          : day,
      ),
    );
  }

  return {
    programName,
    days,
    setProgramName,
    renameDay,
    addExercises,
    removeExercise,
    setTargetSets,
  };
}
