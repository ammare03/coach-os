import { useCallback, useState } from 'react';

import { api } from '../../../lib/trpc.ts';
import { useMidSessionClients, useProgramDay } from '../api/programs.ts';
import { applyOrder } from '../drag-reorder.ts';

// Query + mutation orchestration for the program day screen
// (`program-builder/02`). The screen renders; this decides what is
// re-fetched after each write.

export function useProgramDayBuilder(programDayId: string) {
  const utils = api.useUtils();
  const day = useProgramDay(programDayId);
  const programId = day.data?.programId;

  // `session-runtime/09` step 5. Asked after every write that rewrites a
  // prescription, because that is the instant the answer changes what the
  // coach believes just happened — a coach who thinks they fixed a client's
  // working weight and did not will make a worse decision than one who
  // knows. Disabled by default and refetched here, so a day screen left
  // open does not poll it.
  //
  // ⚠️ Millisecond-wide race, recorded rather than hidden: a client who
  // STARTS between the save committing and this refetch is named by a
  // warning that is not true of them. The dangerous direction cannot
  // happen — a client mid-session when the write landed is still
  // mid-session a moment later. Closing it entirely means reading inside
  // each write's transaction, which would couple seven procedure contracts
  // to one advisory (`apps/api/src/features/programs/mid-session-clients.ts`
  // decision (a)).
  const midSession = useMidSessionClients(programDayId);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const { refetch: refetchMidSession } = midSession;

  /**
   * Called by EVERY write that rewrites a prescription — the three plain
   * mutations through `invalidate`, and the three optimistic ones from
   * their own `onSettled`, which deliberately do not invalidate
   * `programs.get`. A reorder or a regrouping changes what a client would
   * be shown next just as much as a target edit does, so skipping them
   * would leave the warning correct for some saves and silently absent for
   * others — the worst of the three possible behaviours.
   */
  const refreshMidSession = useCallback(async () => {
    // Un-dismissed first: this reports a live fact, not an event, so a save
    // that is still true earns the warning back.
    setDismissedWarning(false);
    await refetchMidSession();
  }, [refetchMidSession]);

  // Two keys, both genuinely stale, and neither of them the whole cache
  // (`code-conventions` §5): adding or removing an exercise changes this
  // day's blocks AND the "5 exercises" meta line the builder screen behind
  // it renders from `programs.get`'s own count. Invalidating only the day
  // would leave the screen a coach backs out to disagreeing with the one
  // they just left. The third is task 09's warning, above.
  const invalidate = useCallback(async () => {
    await Promise.all([
      utils.programs.days.get.invalidate({ programDayId }),
      programId === undefined ? Promise.resolve() : utils.programs.get.invalidate({ programId }),
      refreshMidSession(),
    ]);
  }, [utils, programDayId, programId, refreshMidSession]);

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
      await Promise.all([
        utils.programs.days.get.invalidate({ programDayId }),
        refreshMidSession(),
      ]);
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
      await Promise.all([
        utils.programs.days.get.invalidate({ programDayId }),
        refreshMidSession(),
      ]);
    },
  });

  // `program-builder/05`'s commit. NOT optimistic, unlike the two above,
  // and the difference is the point: reorder and grouping are gestures a
  // coach makes ON the list they are looking at, so a round trip's delay
  // reads as a dropped tap — approving swaps is a form the coach fills in
  // and then commits, and the sheet's own footer is already showing them
  // that it is saving. Guessing here would buy nothing and would have to
  // guess the server's resolved NAMES, which the device does not hold for
  // an exercise it only knows the id of.
  //
  // Only this day's key is touched: a swap list changes no count, so
  // `programs.get`'s "5 exercises" line is not stale.
  const setAlternatives = api.programs.exercises.setAlternatives.useMutation({
    // Reconciled against what the server actually settled on, the same
    // bargain the two above make — the resolved list comes back named and
    // in the coach's own order.
    onSuccess: (result, { programExerciseId }) => {
      const current = utils.programs.days.get.getData({ programDayId });
      if (!current) return;
      utils.programs.days.get.setData(
        { programDayId },
        {
          ...current,
          exercises: current.exercises.map((exercise) =>
            exercise.id === programExerciseId
              ? { ...exercise, alternatives: result.alternatives }
              : exercise,
          ),
        },
      );
    },
    onSettled: async () => {
      await Promise.all([
        utils.programs.days.get.invalidate({ programDayId }),
        refreshMidSession(),
      ]);
    },
  });

  return {
    day,
    addExercise,
    updateExercise,
    removeExercise,
    reorderExercises,
    setSupersetGroup,
    setAlternatives,
    /**
     * `session-runtime/09` step 5 — the names the mid-session warning
     * renders, or `[]` for nobody.
     *
     * `[]` while the query has never run and `[]` on a failed read, and
     * both are deliberate: a warning that cannot be resolved must not
     * become a second failure on a screen whose save already succeeded.
     * Nothing here is allowed to block, refuse, or undo the coach's edit
     * (`session-runtime/09` Approach step 6).
     */
    midSessionClientNames: dismissedWarning
      ? []
      : (midSession.data ?? []).map((client) => client.name),
    dismissMidSessionWarning: () => {
      setDismissedWarning(true);
    },
  };
}
