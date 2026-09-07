import { useCallback } from 'react';

import { api } from '../../../lib/trpc.ts';
import { useProgramDay } from '../api/programs.ts';

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

  return { day, addExercise, updateExercise, removeExercise };
}
