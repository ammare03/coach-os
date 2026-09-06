import { schema, type DbClient } from '@coachos/db';
import { and, asc, ilike, isNull, or, eq } from 'drizzle-orm';

// `exercises.search` (`phase-06-onboarding/coach-onboarding/03`) — the
// minimum needed to pick an exercise before P07 builds the real library.
//
// Substring matching over `name`, which is what the `exercises_trgm` GIN
// index (DB§5.2) exists for. **Not** the `search_vector` full-text index,
// deliberately: a coach typing "squa" into a picker expects Back Squat
// back, and `to_tsquery` on a prefix fragment does not give it to them
// without a `:*` dance this task does not need. P07 owns the real search,
// with both strategies and the ranking to choose between them.

/**
 * A projection of `training.exercises`, derived from the table rather than
 * redeclared — the `no-hand-written-row-type` rule's whole point, and it
 * means a column type change reaches this signature on its own.
 */
export type ExerciseSearchResult = Pick<
  typeof schema.exercises.$inferSelect,
  'id' | 'name' | 'primaryMuscle' | 'equipment'
>;

/** One screen of a picker. P07's library is paginated; this is not, on purpose. */
const RESULT_LIMIT = 30;

export function searchExercises(
  db: DbClient,
  coachProfileId: string,
  query: string,
): Promise<ExerciseSearchResult[]> {
  // The global library plus this coach's own custom exercises, and no other
  // coach's. `coach_id IS NULL` is what makes an exercise global (DB§5.2).
  const visible = or(
    isNull(schema.exercises.coachId),
    eq(schema.exercises.coachId, coachProfileId),
  );
  // `%` and `_` typed by the coach act as LIKE wildcards rather than
  // literals. Drizzle parameterises the value, so this is a matching
  // nicety and not an injection — and in an exercise-name picker a stray
  // wildcard returns more rows, never someone else's.
  const matches =
    query.length > 0 ? and(visible, ilike(schema.exercises.name, `%${query}%`)) : visible;

  return db
    .select({
      id: schema.exercises.id,
      name: schema.exercises.name,
      primaryMuscle: schema.exercises.primaryMuscle,
      equipment: schema.exercises.equipment,
    })
    .from(schema.exercises)
    .where(and(matches, isNull(schema.exercises.archivedAt)))
    .orderBy(asc(schema.exercises.name))
    .limit(RESULT_LIMIT);
}
