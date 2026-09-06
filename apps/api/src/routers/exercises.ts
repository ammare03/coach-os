import { exercises as exercisesSchemas } from '@coachos/schemas';

import { searchExercises } from '../features/exercises/search-exercises.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure } from '../trpc/procedures.ts';

// `list`/`create`/`update`/`archive` are filled by
// phase-07-exercise-and-program-authoring. `search` lands early because
// `phase-06-onboarding/coach-onboarding/03`'s program step has to let a
// coach pick an exercise, and the seeded global library is already there.
export const exercisesRouter = router({
  // `coachProcedure`: the result is the global library plus the caller's
  // OWN custom exercises, and `search-exercises.ts` resolves that from
  // `ctx.user.coachProfileId` rather than from anything the caller sends.
  search: coachProcedure
    .input(exercisesSchemas.searchExercisesInput)
    .query(({ ctx, input }) => searchExercises(ctx.db, ctx.user.coachProfileId, input.query)),
});
