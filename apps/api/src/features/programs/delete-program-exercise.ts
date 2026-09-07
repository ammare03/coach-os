import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `programs.exercises.delete`. Ownership is
// `ownsResource('programExercise', …)` in the router.
//
// The remaining rows keep their `order_index` and the gap stays — the
// unique index is on `(program_day_id, order_index)`, which tolerates
// gaps, and a delete that renumbered its siblings would be
// `program-builder/03`'s reorder wearing a different name. Appending reads
// the current maximum, so a gap never collides with a later add.
export async function deleteProgramExercise(
  db: DbClient,
  programExerciseId: string,
): Promise<void> {
  await db.delete(schema.programExercises).where(eq(schema.programExercises.id, programExerciseId));
}
