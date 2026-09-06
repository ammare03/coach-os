import { schema } from '@coachos/db';
import { exercises as exercisesSchemas } from '@coachos/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { searchExercises } from '../features/exercises/search-exercises.ts';
import { appError } from '../lib/app-error.ts';
import {
  afterCursor,
  decodeExerciseCursor,
  encodeExerciseCursor,
  exerciseListOrder,
} from '../services/exercises/cursor.ts';
import { exerciseColumns, toExercise, visibleToCoach } from '../services/exercises/visibility.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure } from '../trpc/procedures.ts';

// `create`/`update`/`archive` are filled by `exercise-library/03`.
//
// Every procedure here is a `coachProcedure`, and every query composes
// `visibleToCoach(ctx.user.coachProfileId)` — the global library plus the
// caller's OWN custom exercises, resolved from the session rather than from
// anything the caller sends. `coachId` appears nowhere in this file on
// purpose (`services/exercises/visibility.ts`).
export const exercisesRouter = router({
  // Archived exercises are EXCLUDED here and INCLUDED by `get`. That is not
  // an inconsistency to tidy up (`exercise-library/01`, Approach step 2): a
  // coach building a program must not be offered a retired movement, and a
  // three-year-old set log still points at one whose name session review
  // has to render. `search` follows `list`.
  list: coachProcedure.input(exercisesSchemas.listExercisesInput).query(async ({ ctx, input }) => {
    const cursor = input.cursor ? decodeExerciseCursor(input.cursor) : null;

    const rows = await ctx.db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(
        and(
          visibleToCoach(ctx.user.coachProfileId),
          isNull(schema.exercises.archivedAt),
          input.primaryMuscle ? eq(schema.exercises.primaryMuscle, input.primaryMuscle) : undefined,
          input.equipment ? eq(schema.exercises.equipment, input.equipment) : undefined,
          input.movementPattern
            ? eq(schema.exercises.movementPattern, input.movementPattern)
            : undefined,
          cursor ? afterCursor(cursor) : undefined,
        ),
      )
      .orderBy(...exerciseListOrder)
      .limit(input.limit);

    const last = rows[rows.length - 1];
    return {
      items: rows.map(toExercise),
      // A short page is the last page. Only a full one can have more behind
      // it, and issuing a cursor for a short page costs the client a round
      // trip to learn nothing.
      nextCursor:
        rows.length === input.limit && last
          ? encodeExerciseCursor({ name: last.name, exerciseId: last.id })
          : null,
    };
  }),

  // NOT_FOUND, never FORBIDDEN, for another coach's custom exercise: a 403
  // would confirm the row exists, which is the enumeration oracle
  // `security-and-privacy` §1 closes. Indistinguishable from an id that
  // names nothing, which is the point.
  get: coachProcedure.input(exercisesSchemas.getExerciseInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(
        and(visibleToCoach(ctx.user.coachProfileId), eq(schema.exercises.id, input.exerciseId)),
      )
      .limit(1);

    if (!row) throw appError('EXERCISE_NOT_FOUND', 'That exercise is no longer available.', {});
    return toExercise(row);
  }),

  // `coachProcedure`: the result is the global library plus the caller's
  // OWN custom exercises, and `search-exercises.ts` resolves that from
  // `ctx.user.coachProfileId` rather than from anything the caller sends.
  search: coachProcedure
    .input(exercisesSchemas.searchExercisesInput)
    .query(({ ctx, input }) => searchExercises(ctx.db, ctx.user.coachProfileId, input.query)),
});
