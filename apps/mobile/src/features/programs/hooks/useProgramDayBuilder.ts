import { useCallback } from 'react';

import { api } from '../../../lib/trpc.ts';
import { useProgramDay } from '../api/programs.ts';
import { applyOrder } from '../drag-reorder.ts';

// Query + mutation orchestration for the program day screen
// (`program-builder/02`). The screen renders; this decides what is
// re-fetched after each write.

export function useProgramDayBuilder(programDayId: string) {
  const utils = api.useUtils();
  const day = useProgramDay(programDayId);
  const programId = day.data?.programId;

  // Two keys, both genuinely stale, and neither of them the whole cache
  // (`code-conventions` §5): adding or removing an exercise changes this
  // day's blocks AND the "5 exercises" meta line the builder screen behind
  // it renders from `programs.get`'s own count. Invalidating only the day
  // would leave the screen a coach backs out to disagreeing with the one
  // they just left.
  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.programs.days.get.invalidate({ programDayId }),
      programId === undefined ? Promise.resolve() : utils.programs.get.invalidate({ programId }),
    ]);
  }, [utils, programDayId, programId]);

  const addExercise = api.programs.exercises.create.useMutation({ onSuccess: invalidate });
  const updateExercise = api.programs.exercises.update.useMutation({ onSuccess: invalidate });
  const removeExercise = api.programs.exercises.delete.useMutation({ onSuccess: invalidate });

  // `program-builder/03`'s drop. Optimistic, unlike the three above: the
  // card has already travelled to its new slot by the time this fires, so
  // waiting for a round trip would mean watching it snap back and forward
  // again. Only this day's key is touched — a reorder changes no count, so
  // `programs.get`'s "5 exercises" line is not stale.
  const reorderExercises = api.programs.exercises.reorder.useMutation({
    onMutate: async ({ programDayId: dayId, orderedExerciseIds }) => {
      await utils.programs.days.get.cancel({ programDayId: dayId });
      const previous = utils.programs.days.get.getData({ programDayId: dayId });
      if (previous) {
        utils.programs.days.get.setData(
          { programDayId: dayId },
          { ...previous, exercises: applyOrder(previous.exercises, orderedExerciseIds) },
        );
      }
      return { previous };
    },
    // Reconciled against what the server actually settled on rather than
    // left on the optimistic guess — a block deleted on another device mid
    // drag comes back in the server's order, not ours.
    onSuccess: (result, { programDayId: dayId }) => {
      const current = utils.programs.days.get.getData({ programDayId: dayId });
      if (!current) return;
      utils.programs.days.get.setData(
        { programDayId: dayId },
        {
          ...current,
          exercises: applyOrder(
            current.exercises,
            result.exercises.map((exercise) => exercise.id),
          ),
        },
      );
    },
    // The order the coach was looking at, put back exactly as it was. The
    // screen surfaces the refusal separately; this only undoes the guess.
    onError: (_error, { programDayId: dayId }, context) => {
      if (context?.previous) {
        utils.programs.days.get.setData({ programDayId: dayId }, context.previous);
      }
    },
    onSettled: async () => {
      await utils.programs.days.get.invalidate({ programDayId });
    },
  });

  // `program-builder/04`'s grouping and ungrouping. Optimistic for the same
  // reason the reorder is: the tint, the rail and the badges are what the
  // coach is looking at when they tap, and a round trip's worth of
  // unchanged list would read as a dropped tap. Only this day's key is
  // touched — grouping changes no count, so `programs.get`'s "5 exercises"
  // line is not stale.
  const setSupersetGroup = api.programs.exercises.setSupersetGroup.useMutation({
    onMutate: async ({ programDayId: dayId, exerciseIds, group }) => {
      await utils.programs.days.get.cancel({ programDayId: dayId });
      const previous = utils.programs.days.get.getData({ programDayId: dayId });
      if (previous) {
        const touched = new Set(exerciseIds);
        utils.programs.days.get.setData(
          { programDayId: dayId },
          {
            ...previous,
            exercises: previous.exercises.map((exercise) =>
              touched.has(exercise.id) ? { ...exercise, supersetGroup: group } : exercise,
            ),
          },
        );
      }
      return { previous };
    },
    // Reconciled against what the server actually settled on: a letter
    // taken by another device comes back as the server holds it, not as we
    // guessed it.
    onSuccess: (result, { programDayId: dayId }) => {
      const current = utils.programs.days.get.getData({ programDayId: dayId });
      if (!current) return;
      const settled = new Map(result.exercises.map((exercise) => [exercise.id, exercise]));
      utils.programs.days.get.setData(
        { programDayId: dayId },
        {
          ...current,
          exercises: current.exercises.map((exercise) => {
            const row = settled.get(exercise.id);
            return row ? { ...exercise, supersetGroup: row.supersetGroup } : exercise;
          }),
        },
      );
    },
    onError: (_error, { programDayId: dayId }, context) => {
      if (context?.previous) {
        utils.programs.days.get.setData({ programDayId: dayId }, context.previous);
      }
    },
    onSettled: async () => {
      await utils.programs.days.get.invalidate({ programDayId });
    },
  });

  return {
    day,
    addExercise,
    updateExercise,
    removeExercise,
    reorderExercises,
    setSupersetGroup,
  };
}
