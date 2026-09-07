import { schema, type DbClient } from '@coachos/db';
import { programs as programsSchemas } from '@coachos/schemas';
import { and, count, eq, max } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { visibleToCoach } from '../../services/exercises/visibility.ts';

import { targetColumns, type ProgramExerciseTargets } from './program-exercise-targets.ts';
import { bumpProgramVersion, programIdForDay } from './program-version.ts';

// `programs.exercises.create` — the commit at the end of the
// picker-then-target flow (`program-builder/02`, frames 1b and 1c).
// Ownership of the DAY is `ownsResource('programDay', …)` in the router;
// the exercise's own visibility is checked here, because it is not an
// ownership question — see below.

const { maxExercisesPerDay } = programsSchemas.PROGRAM_BOUNDS;

export interface CreateProgramExerciseInput extends ProgramExerciseTargets {
  programDayId: string;
  exerciseId: string;
}

export async function createProgramExercise(
  db: DbClient,
  coachProfileId: string,
  input: CreateProgramExerciseInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // The global library plus this coach's own custom rows, and nothing
    // else — the same predicate `exercises.*` composes
    // (`services/exercises/visibility.ts`). Pre-checked rather than left to
    // the `RESTRICT` FK: an unchecked id would surface as a foreign-key
    // violation the boundary can only report as `UNKNOWN_CONFLICT`, and it
    // would let a coach confirm another coach's custom exercise exists by
    // which error came back. `EXERCISE_NOT_FOUND` is the same answer
    // `exercises.get` gives, for the same reason (`ERRORS.md` ER§2.1).
    const [exercise] = await tx
      .select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(and(eq(schema.exercises.id, input.exerciseId), visibleToCoach(coachProfileId)))
      .limit(1);
    if (!exercise) {
      throw appError('EXERCISE_NOT_FOUND', "We couldn't find that exercise.", {});
    }

    const [existing] = await tx
      .select({ total: count(), lastOrderIndex: max(schema.programExercises.orderIndex) })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, input.programDayId));

    const total = existing?.total ?? 0;
    if (total >= maxExercisesPerDay) {
      // The day screen hides "Add exercise" at the ceiling, so reaching
      // this needs a stale client or two devices racing — the same shape
      // `PROGRAM_WEEK_LIMIT_REACHED` has. Numbers only, never copy (DB§18).
      throw appError('PROGRAM_EXERCISE_LIMIT_REACHED', 'This day is full.', {
        maxExercises: maxExercisesPerDay,
      });
    }

    // Appended, never positioned by the caller. `program_builder/03` owns
    // moving a row; until then the order a coach adds in is the order they
    // see. Reading the current maximum inside the transaction is what keeps
    // `program_exercises_program_day_id_order_index_unique` from firing
    // when two blocks are added at once.
    const orderIndex = (existing?.lastOrderIndex ?? 0) + 1;

    const [row] = await tx
      .insert(schema.programExercises)
      .values({
        programDayId: input.programDayId,
        exerciseId: input.exerciseId,
        orderIndex,
        ...targetColumns(input),
      })
      .returning({ id: schema.programExercises.id });
    if (!row) throw new Error('insert into training.program_exercises did not return a row');

    const programId = await programIdForDay(tx, input.programDayId);
    if (programId) await bumpProgramVersion(tx, programId);

    return { id: row.id };
  });
}
