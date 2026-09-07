import { useCallback } from 'react';

import { api } from '../../../lib/trpc.ts';
import { useProgram } from '../api/programs.ts';

// Query + mutation orchestration for the builder screen
// (`program-builder/01`). The screen renders; this decides what is
// re-fetched after each write.

export function useProgramBuilder(programId: string) {
  const utils = api.useUtils();
  const program = useProgram(programId);

  // The narrowest key that is now stale (`code-conventions` §5): every
  // mutation here changes the shape of exactly one program, and
  // `queryClient.invalidateQueries()` with no key is banned.
  //
  // A week or day write moves counts on the week header, the day row, and
  // the program's own length in one go, so the whole `programs.get` for
  // this id is the honest unit — invalidating a narrower slice would leave
  // the header disagreeing with the rows under it.
  const invalidate = useCallback(async () => {
    await utils.programs.get.invalidate({ programId });
  }, [utils, programId]);

  const updateProgram = api.programs.update.useMutation({ onSuccess: invalidate });
  const addWeek = api.programs.weeks.create.useMutation({ onSuccess: invalidate });
  const removeWeek = api.programs.weeks.delete.useMutation({ onSuccess: invalidate });
  const addDay = api.programs.days.create.useMutation({ onSuccess: invalidate });
  const updateDay = api.programs.days.update.useMutation({ onSuccess: invalidate });
  const removeDay = api.programs.days.delete.useMutation({ onSuccess: invalidate });

  return { program, updateProgram, addWeek, removeWeek, addDay, updateDay, removeDay };
}
