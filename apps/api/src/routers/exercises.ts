import { schema } from '@coachos/db';
import { exercises as exercisesSchemas } from '@coachos/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { appError } from '../lib/app-error.ts';
import {
  checkExerciseName,
  createExercise,
  setExerciseArchived,
  updateExercise,
} from '../services/exercises/authoring.ts';
import {
  afterCursor,
  decodeExerciseCursor,
  encodeExerciseCursor,
  exerciseListOrder,
} from '../services/exercises/cursor.ts';
import { searchExercises } from '../services/exercises/search.ts';
import { exerciseColumns, toExercise, visibleToCoach } from '../services/exercises/visibility.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, RATE_LIMIT_TIERS, rateLimit } from '../trpc/procedures.ts';

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

  // The three-tier ladder (`services/exercises/search.ts`): exact, then
  // full-text, then trigram as a top-up. `coachProcedure`, and the
  // visibility predicate is resolved from `ctx.user.coachProfileId` inside
  // each tier rather than from anything the caller sends.
  //
  // CLAUDE.md §6.5 / `api-conventions` §7: 120/min/user, chained after
  // `.input()`. The 600/min default every procedure inherits from
  // `publicProcedure` still applies underneath; this is the tighter bucket
  // that actually governs a debounced keystroke path.
  search: coachProcedure
    .input(exercisesSchemas.searchExercisesInput)
    .use(rateLimit(RATE_LIMIT_TIERS.exercisesSearch))
    .query(({ ctx, input }) =>
      searchExercises(ctx.db, ctx.user.coachProfileId, input.query, input.limit, {
        primaryMuscle: input.primaryMuscle,
        equipment: input.equipment,
        movementPattern: input.movementPattern,
      }),
    ),

  // The advisory lookup the create form runs while the coach types. Two of
  // `exercise-library/03`'s three collisions are legal under DB§5.2 and
  // still need surfacing; `search` cannot answer for the archived one
  // because it excludes archived rows by design.
  checkName: coachProcedure
    .input(exercisesSchemas.checkExerciseNameInput)
    .query(({ ctx, input }) => checkExerciseName(ctx.db, ctx.user.coachProfileId, input.name)),

  create: coachProcedure
    .input(exercisesSchemas.createExerciseInput)
    .mutation(({ ctx, input }) => createExercise(ctx.db, ctx.user.coachProfileId, input)),

  update: coachProcedure
    .input(exercisesSchemas.updateExerciseInput)
    .mutation(({ ctx, input }) => updateExercise(ctx.db, ctx.user.coachProfileId, input)),

  // Archive, never delete. `ON DELETE RESTRICT` from `program_exercises`
  // and `set_logs` means a hard delete is not merely discouraged — it is
  // impossible for any exercise with history.
  archive: coachProcedure
    .input(exercisesSchemas.archiveExerciseInput)
    .mutation(({ ctx, input }) =>
      setExerciseArchived(ctx.db, ctx.user.coachProfileId, input.exerciseId, true),
    ),

  unarchive: coachProcedure
    .input(exercisesSchemas.archiveExerciseInput)
    .mutation(({ ctx, input }) =>
      setExerciseArchived(ctx.db, ctx.user.coachProfileId, input.exerciseId, false),
    ),
});
