import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { targetColumns, type ProgramExerciseTargets } from './program-exercise-targets.ts';

// `programs.exercises.update` — the target sheet reopened on an existing
// block. Ownership is `ownsResource('programExercise', …)` in the router.
//
// A whole-block replace, matching `packages/schemas`' `targetBlockShape`:
// the sheet shows every field, so it sends every field, and an omitted one
// is a cleared one. `order_index`, `exercise_id`, `superset_group` and
// `alternatives` are deliberately untouched — they belong to tasks 03, 04
// and 05, and a "replace the block" that silently reset them would undo
// their work from a sheet that never showed it.

export interface UpdateProgramExerciseInput extends ProgramExerciseTargets {
  programExerciseId: string;
}

export async function updateProgramExercise(
  db: DbClient,
  input: UpdateProgramExerciseInput,
): Promise<void> {
  // `updated_at` is maintained by DB§8.1's trigger — nothing to set here.
  await db
    .update(schema.programExercises)
    .set(targetColumns(input))
    .where(eq(schema.programExercises.id, input.programExerciseId));
}
