import { programs as programsSchemas } from '@coachos/schemas';

import { createProgram } from '../features/programs/create-program.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure } from '../trpc/procedures.ts';

// `list`/`get`/`duplicate`/`update`/`delete`/`assign` are filled by
// phase-07-exercise-and-program-authoring. `create` lands early because
// `phase-06-onboarding/coach-onboarding/03` needs it: a coach finishes
// onboarding with a real program, not a placeholder.
export const programsRouter = router({
  // `coachProcedure`, and no `ownsResource`: the owning coach is
  // `ctx.user.coachProfileId` and no id from `input` addresses a row this
  // caller might not own — `exerciseId` references the global library or
  // the caller's own custom exercises, and a foreign coach's custom
  // exercise id would fail the visibility check in `exercises.search`
  // before it could ever reach here.
  create: coachProcedure
    .input(programsSchemas.createProgramInput)
    .mutation(({ ctx, input }) => createProgram(ctx.db, ctx.user.coachProfileId, input)),
});
