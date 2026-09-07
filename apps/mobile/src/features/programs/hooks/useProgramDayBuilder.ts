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

  return { day, addExercise, updateExercise, removeExercise, reorderExercises };
}
