import { schema } from '@coachos/db';
import { eq, isNull, or, sql, type SQL } from 'drizzle-orm';

// The one module in the API that reads `training.exercises.coach_id`
// (`exercise-library/01`, Approach step 1 and Risks). Every `exercises.*`
// query composes the predicate below; nothing inlines it. Grep the router
// for `coachId` and expect zero hits — the moment one query writes the
// predicate itself, cross-coach isolation stops being a mechanism and
// becomes a convention.

/**
 * "Exercises this coach may see": the global library (`coach_id IS NULL`,
 * DB§5.2) plus their own custom rows, and nothing else, ever.
 *
 * Returns `SQL | undefined` rather than `SQL` only because that is `or()`'s
 * declared type; with two defined operands it never actually returns
 * `undefined`, and `and()` accepts either, so no call site needs a guard.
 */
export function visibleToCoach(coachProfileId: string): SQL | undefined {
  return or(isNull(schema.exercises.coachId), eq(schema.exercises.coachId, coachProfileId));
}

/**
 * "Exercises this coach *owns*" — their custom rows only, excluding the
 * global library. Narrower than {@link visibleToCoach}, and needed by
 * exactly one caller: `reconcile.ts`'s pass 4, which looks for duplicates
 * "within one coach's custom library" (`exercise-library/06`) and would
 * otherwise have to write `eq(exercises.coachId, …)` itself.
 *
 * It lives here rather than there for the reason at the top of this file:
 * this module is the only place in the API that reads
 * `training.exercises.coach_id`, and that stops being a mechanism the
 * moment a second file writes the predicate.
 */
export function ownedByCoach(coachProfileId: string): SQL {
  return eq(schema.exercises.coachId, coachProfileId);
}

/**
 * The tie-breaker every `exercises.*` ordering puts first: a coach's own
 * custom exercise ranks above a global one at equal relevance. `false`
 * sorts before `true` in Postgres, so ascending on "is this global" puts
 * custom first. Lives here rather than in `search.ts` for the same reason
 * the predicate does — it is the other expression that reads `coach_id`.
 */
export const customFirst = sql`(${schema.exercises.coachId} IS NULL)`;

/**
 * The client-facing projection. Explicit columns, never `select()` and
 * never a spread (`routers/README.md`): a column added to the table later
 * must not reach the wire because nobody edited this list.
 *
 * `isCustom` is derived here and `coach_id` is not returned. The client
 * needs to know whether an edit affordance applies; it does not need
 * another coach-profile id to compare against, and a future change to the
 * visibility model should not change the client contract.
 */
export const exerciseColumns = {
  id: schema.exercises.id,
  name: schema.exercises.name,
  aliases: schema.exercises.aliases,
  primaryMuscle: schema.exercises.primaryMuscle,
  secondaryMuscles: schema.exercises.secondaryMuscles,
  equipment: schema.exercises.equipment,
  movementPattern: schema.exercises.movementPattern,
  cues: schema.exercises.cues,
  isUnilateral: schema.exercises.isUnilateral,
  isBodyweight: schema.exercises.isBodyweight,
  defaultIncrementKg: schema.exercises.defaultIncrementKg,
  demoAssetId: schema.exercises.demoAssetId,
  archivedAt: schema.exercises.archivedAt,
  isCustom: sql<boolean>`${schema.exercises.coachId} IS NOT NULL`,
};

/**
 * Derived from the table, never hand-written (`code-conventions` §3): a
 * column whose type changes reaches this shape on its own. `isCustom` is
 * the one field added on top, because it is computed rather than selected.
 */
type ExerciseRow = Pick<
  typeof schema.exercises.$inferSelect,
  | 'id'
  | 'name'
  | 'aliases'
  | 'primaryMuscle'
  | 'secondaryMuscles'
  | 'equipment'
  | 'movementPattern'
  | 'cues'
  | 'isUnilateral'
  | 'isBodyweight'
  | 'defaultIncrementKg'
  | 'demoAssetId'
  | 'archivedAt'
> & { isCustom: boolean };

/** What every `exercises.*` procedure returns for one exercise. */
export interface Exercise extends Omit<ExerciseRow, 'defaultIncrementKg'> {
  defaultIncrementKg: number;
}

/** DB§5.2's column default, restated for the null case the column still permits. */
const FALLBACK_INCREMENT_KG = 2.5;

/**
 * `numeric` crosses the Drizzle boundary as a string, and the column is
 * nullable even though it defaults to 2.5. The plate math in
 * `phase-09-workout-logger/set-entry/02` needs a number on every exercise,
 * so the conversion and the fallback happen once, here.
 */
export function toExercise(row: ExerciseRow): Exercise {
  const parsed = row.defaultIncrementKg === null ? Number.NaN : Number(row.defaultIncrementKg);
  return {
    ...row,
    defaultIncrementKg: Number.isFinite(parsed) ? parsed : FALLBACK_INCREMENT_KG,
  };
}
