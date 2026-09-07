import { schema, type DbClient, type ProgramExercise } from '@coachos/db';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

// `programs.exercises.reorder` — the drop at the end of a drag
// (`program-builder/03`, frame 1d). Ownership of the DAY and of every id in
// `orderedExerciseIds` is established by the two `ownsResource` guards in
// the router; what is checked here is the thing ownership cannot answer —
// that those ids are exactly this day's blocks.

export interface ReorderProgramExercisesInput {
  programDayId: string;
  orderedExerciseIds: string[];
}

/**
 * What the client reconciles its optimistic order against — the two columns
 * of the row that a reorder can change, taken from the inferred row type
 * rather than restated (`CLAUDE.md` §17.1).
 */
export type ReorderedProgramExercise = Pick<ProgramExercise, 'id' | 'orderIndex'>;

/**
 * ## Why this is two statements and not one
 *
 * `program_exercises_program_day_id_order_index_unique` is a plain unique
 * index, and PostgreSQL checks a plain unique index **per row**, as each
 * row is updated — not at the end of the statement and not at the end of
 * the transaction. So the obvious single `UPDATE ... SET order_index =
 * CASE id ... END` that assigns the finals directly still trips the index
 * the moment one row is written to a position another row has not yet
 * vacated, which is every reorder whose new order overlaps its old one.
 * (A `DEFERRABLE` constraint would fix it at the schema level; DB§5.2 does
 * not declare one, and this task adds no migration.)
 *
 * So the rows are parked out of the way first:
 *
 * 1. **Park.** One `UPDATE` sets every named row to `-(its new position)` —
 *    `-1 … -N`, distinct by construction. Every row currently in the day
 *    holds a positive index (`createProgramExercise` assigns `max + 1`
 *    starting at 1, and nothing else writes this column), so no target
 *    value can collide with a value any row still holds.
 * 2. **Flip.** One `UPDATE` negates them back. Every row of the day is
 *    negative at that point, so again no target value collides with a value
 *    any row still holds, and `-k → k` is injective.
 *
 * Both statements are collision-free *at every individual row write*, which
 * is the property the index actually requires. The negative window exists
 * only inside the transaction and is never observable.
 *
 * A "shift everything by a large constant" variant would work too, but
 * `order_index` is a `smallint` and the safe offset depends on the day's
 * current maximum; the sign flip needs no arithmetic that can overflow.
 */
export async function reorderProgramExercises(
  db: DbClient,
  input: ReorderProgramExercisesInput,
): Promise<{ exercises: ReorderedProgramExercise[] }> {
  const requested = input.orderedExerciseIds;

  return db.transaction(async (tx) => {
    // `FOR UPDATE` so two devices reordering the same day serialise here
    // rather than interleaving their parks and flips.
    const current = await tx
      .select({ id: schema.programExercises.id })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, input.programDayId))
      .for('update');

    const dayIds = new Set(current.map((row) => row.id));
    const requestedIds = new Set(requested);

    // Three failures, one answer. A list that is short, long, duplicated,
    // or names a block of another day of this coach's own is the same fact
    // from the client's side: the picture it dropped against is not the day
    // the server holds, and the recovery is to refetch and move again.
    // (A block belonging to ANOTHER coach never reaches here —
    // `ownsResource('programExercise', …)` refuses the whole call first.)
    const isCompletePermutation =
      requestedIds.size === requested.length &&
      requestedIds.size === dayIds.size &&
      requested.every((id) => dayIds.has(id));
    if (!isCompletePermutation) {
      // Numbers only, never a name or an id (DB§18).
      throw appError('PROGRAM_DAY_ORDER_STALE', 'This day changed somewhere else.', {
        exerciseCount: dayIds.size,
      });
    }

    const parkedIndex = sql.join(
      requested.map((id, position) => sql`when ${id}::uuid then ${-(position + 1)}::smallint`),
      sql` `,
    );

    // Step 1 — park. Scoped to the named ids as well as the day, so a row
    // inserted by another device after the `SELECT` above is left alone
    // rather than matching no `WHEN` arm and being set to NULL.
    await tx
      .update(schema.programExercises)
      .set({ orderIndex: sql`case ${schema.programExercises.id} ${parkedIndex} end` })
      .where(
        and(
          eq(schema.programExercises.programDayId, input.programDayId),
          inArray(schema.programExercises.id, requested),
        ),
      );

    // Step 2 — flip.
    await tx
      .update(schema.programExercises)
      .set({ orderIndex: sql`-${schema.programExercises.orderIndex}` })
      .where(
        and(
          eq(schema.programExercises.programDayId, input.programDayId),
          lt(schema.programExercises.orderIndex, 0),
        ),
      );

    // Read back rather than echoing the input: this is what the client
    // reconciles its optimistic order against, so it has to be what the
    // database actually holds.
    const settled = await tx
      .select({
        id: schema.programExercises.id,
        orderIndex: schema.programExercises.orderIndex,
      })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, input.programDayId))
      .orderBy(asc(schema.programExercises.orderIndex));

    return { exercises: settled };
  });
}
