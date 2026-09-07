import { useUndoToast } from '@coachos/ui';
import { useCallback } from 'react';

import { api } from '../../../lib/trpc.ts';

// Create / update / archive / un-archive, with the cache invalidation each
// one implies (`exercise-library/03`).
//
// **Archive is an undo toast, not a confirmation dialog** (`CLAUDE.md`
// §7.5). The action performs immediately and offers a five-second window;
// `useUndoToast` defers the server mutation until the window closes, so an
// undo tap has nothing to reverse server-side. The two typed-confirmation
// exceptions §7.5 names are account deletion and client archival, and this
// is neither.

export function useExerciseMutations() {
  const utils = api.useUtils();
  const showUndoToast = useUndoToast();

  // Every list, search and infinite page is invalidated together: a created
  // or renamed exercise can move between any of them, and a partial
  // invalidation is how a coach ends up looking at a stale library and
  // creating the duplicate this whole feature exists to prevent.
  const invalidate = useCallback(async () => {
    await utils.exercises.invalidate();
  }, [utils]);

  const create = api.exercises.create.useMutation({ onSuccess: invalidate });
  const update = api.exercises.update.useMutation({ onSuccess: invalidate });
  const archive = api.exercises.archive.useMutation({ onSuccess: invalidate });
  const unarchive = api.exercises.unarchive.useMutation({ onSuccess: invalidate });

  /**
   * Archive with the undo window.
   *
   * The optimistic hide is the CALLER's — `useUndoToast` defers the server
   * mutation until the window closes, so `onUndo` only has to put the local
   * state back and there is nothing to reverse over the wire. The screen
   * that owns the list is the only thing that can hide a row from it, which
   * is why both callbacks come in rather than being done here.
   */
  const archiveWithUndo = useCallback(
    (exercise: { id: string; name: string }, onUndo: () => void) => {
      showUndoToast({
        // Never "deleted". The action genuinely is not a delete, and
        // `ON DELETE RESTRICT` from `program_exercises` and `set_logs`
        // means it never can be.
        message: `${exercise.name} archived`,
        onUndo,
        onCommit: () => archive.mutate({ exerciseId: exercise.id }),
      });
    },
    [archive, showUndoToast],
  );

  return { create, update, archive, unarchive, archiveWithUndo };
}
