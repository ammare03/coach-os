import { schema, type DbClient } from '@coachos/db';
import type { exercises as exercisesSchemas } from '@coachos/schemas';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { appError } from '../../lib/app-error.ts';

import { exerciseColumns, toExercise, type Exercise } from './visibility.ts';

// `exercises.create` / `update` / `archive` / `unarchive`
// (`exercise-library/03`). Four rules hold across all of them:
//
//   1. `coach_id` comes from the session, never from input. There is no
//      input field for it (`packages/schemas/src/exercises.ts`).
//   2. A GLOBAL exercise (`coach_id IS NULL`) is never written. It is seed-
//      owned; every coach's programs reference it, and an `update` that
//      forgot this check would let one coach rewrite a movement for
//      everyone.
//   3. Another coach's exercise is NOT_FOUND, never FORBIDDEN — the same
//      enumeration-oracle rule `get` follows.
//   4. Nothing here deletes. `archived_at` is set and cleared;
//      `ON DELETE RESTRICT` from `program_exercises` and `set_logs` makes a
//      hard delete impossible for anything with history anyway.

/** DB§5.2's partial unique index on `(coalesce(coach_id, nil), lower(name)) WHERE archived_at IS NULL`. */
const NAME_UNIQUE_INDEX = 'exercises_coach_name';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

type AuthoringFields = exercisesSchemas.CreateExerciseInput;

/**
 * What `exercises.checkName` answers while the coach types. Three of the
 * four are legal outcomes rather than failures — only `yours` is refused
 * on submit, and each of the other two needs its own copy and its own
 * offer (`exercise-library/03`, Approach step 1).
 */
export type NameConflict =
  | { kind: 'none' }
  /** The coach already has this exercise, live. Submitting throws `EXERCISE_NAME_TAKEN`. */
  | { kind: 'yours'; exerciseId: string }
  /** A global exercise has this name. Legal — different namespace — but usually a mistake. */
  | { kind: 'global'; exerciseId: string }
  /** The coach archived this exercise. Un-archiving keeps the movement's history attached. */
  | { kind: 'archived'; exerciseId: string };

/**
 * Ordered deliberately: the coach's own live row is the only refusal, so it
 * is checked first and reported alone. An archived row of the coach's own
 * outranks a global match because it is the case that quietly fragments a
 * library — archive, forget, recreate, and now one movement has two
 * histories.
 */
export async function checkExerciseName(
  db: DbClient,
  coachProfileId: string,
  name: string,
): Promise<NameConflict> {
  const sameName = sql`lower(${schema.exercises.name}) = lower(${name})`;

  const [mine] = await db
    .select({ id: schema.exercises.id, archivedAt: schema.exercises.archivedAt })
    .from(schema.exercises)
    .where(and(sameName, eq(schema.exercises.coachId, coachProfileId)))
    // A live row before an archived one, so a coach who has both gets the
    // refusal rather than the offer.
    .orderBy(sql`${schema.exercises.archivedAt} NULLS FIRST`)
    .limit(1);

  if (mine) {
    return mine.archivedAt === null
      ? { kind: 'yours', exerciseId: mine.id }
      : { kind: 'archived', exerciseId: mine.id };
  }

  const [globalRow] = await db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(and(sameName, isNull(schema.exercises.coachId), isNull(schema.exercises.archivedAt)))
    .limit(1);

  return globalRow ? { kind: 'global', exerciseId: globalRow.id } : { kind: 'none' };
}

/**
 * Attempt the write, catch the unique violation, translate it — never
 * pre-check with a `SELECT` and then insert. The pre-check is a race, and
 * under a double-tapped submit button on a slow connection it produces
 * exactly the raw constraint error it was meant to avoid
 * (`exercise-library/03`, Approach step 2).
 *
 * The re-query only runs on the failure path, and only to find the id the
 * form needs for its "open the existing one" offer — the boundary in
 * `db/error-boundary.ts` cannot supply it, because it is forbidden from
 * reading the one field that would carry it.
 */
async function withNameCollisionTranslated<T>(
  db: DbClient,
  coachProfileId: string,
  name: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const dbError = unwrapDatabaseError(error);
    if (dbError?.code !== UNIQUE_VIOLATION || dbError.constraint_name !== NAME_UNIQUE_INDEX) {
      throw error;
    }
    const conflict = await checkExerciseName(db, coachProfileId, name);
    throw appError('EXERCISE_NAME_TAKEN', 'You already have an exercise called this.', {
      existingExerciseId: conflict.kind === 'none' ? '' : conflict.exerciseId,
    });
  }
}

export function createExercise(
  db: DbClient,
  coachProfileId: string,
  input: AuthoringFields,
): Promise<Exercise> {
  return withNameCollisionTranslated(db, coachProfileId, input.name, async () => {
    const [row] = await db
      .insert(schema.exercises)
      .values({
        // Rule 1. Not `...input` — a spread would carry whatever the caller
        // sent, and the schema being strict today is not a reason to rely
        // on it staying that way.
        coachId: coachProfileId,
        name: input.name,
        primaryMuscle: input.primaryMuscle,
        equipment: input.equipment,
        movementPattern: input.movementPattern,
        cues: input.cues,
        defaultIncrementKg: String(input.defaultIncrementKg),
        isUnilateral: input.isUnilateral,
        isBodyweight: input.isBodyweight,
      })
      .returning(exerciseColumns);
    if (!row) throw new Error('insert into training.exercises returned no row');
    return toExercise(row);
  });
}

/**
 * Resolves which of the three refusals applies before any write. Split out
 * because `update`, `archive`, and `unarchive` must all answer it
 * identically — three copies would eventually disagree, and the copy that
 * disagrees is the one that lets a global exercise be written.
 */
async function assertEditable(
  db: DbClient,
  coachProfileId: string,
  exerciseId: string,
): Promise<void> {
  const [row] = await db
    .select({ coachId: schema.exercises.coachId })
    .from(schema.exercises)
    .where(eq(schema.exercises.id, exerciseId))
    .limit(1);

  // No row, or another coach's row: the same NOT_FOUND either way. A
  // distinct "not yours" would confirm the row exists (`security-and-privacy`
  // §1).
  if (!row || (row.coachId !== null && row.coachId !== coachProfileId)) {
    throw appError('EXERCISE_NOT_FOUND', 'That exercise is no longer available.', {});
  }
  if (row.coachId === null) {
    throw appError(
      'EXERCISE_NOT_EDITABLE',
      "Global exercises can't be edited. Make your own version instead.",
      {},
    );
  }
}

export async function updateExercise(
  db: DbClient,
  coachProfileId: string,
  input: exercisesSchemas.UpdateExerciseInput,
): Promise<Exercise> {
  await assertEditable(db, coachProfileId, input.exerciseId);

  return withNameCollisionTranslated(db, coachProfileId, input.name, async () => {
    const [row] = await db
      .update(schema.exercises)
      .set({
        name: input.name,
        primaryMuscle: input.primaryMuscle,
        equipment: input.equipment,
        movementPattern: input.movementPattern,
        cues: input.cues,
        defaultIncrementKg: String(input.defaultIncrementKg),
        isUnilateral: input.isUnilateral,
        isBodyweight: input.isBodyweight,
      })
      // The ownership predicate is repeated in the `WHERE` even though
      // `assertEditable` just passed: the check and the write are two
      // statements, and only the second one is what actually protects the
      // row.
      .where(
        and(
          eq(schema.exercises.id, input.exerciseId),
          eq(schema.exercises.coachId, coachProfileId),
        ),
      )
      .returning(exerciseColumns);
    if (!row) throw appError('EXERCISE_NOT_FOUND', 'That exercise is no longer available.', {});
    return toExercise(row);
  });
}

/**
 * Archive and un-archive are one function because they are one decision
 * with two directions, and because un-archiving can collide on the name
 * index exactly the way a create can — the coach may have recreated the
 * movement in the meantime.
 */
export async function setExerciseArchived(
  db: DbClient,
  coachProfileId: string,
  exerciseId: string,
  archived: boolean,
): Promise<Exercise> {
  await assertEditable(db, coachProfileId, exerciseId);

  const [current] = await db
    .select({ name: schema.exercises.name })
    .from(schema.exercises)
    .where(eq(schema.exercises.id, exerciseId))
    .limit(1);
  if (!current) throw appError('EXERCISE_NOT_FOUND', 'That exercise is no longer available.', {});

  return withNameCollisionTranslated(db, coachProfileId, current.name, async () => {
    const [row] = await db
      .update(schema.exercises)
      .set({ archivedAt: archived ? new Date() : null })
      .where(
        and(
          eq(schema.exercises.id, exerciseId),
          eq(schema.exercises.coachId, coachProfileId),
          // Idempotent by construction: archiving an already-archived
          // exercise writes nothing and returns it unchanged, which is what
          // a retried undo tap needs.
          archived ? isNull(schema.exercises.archivedAt) : isNotNull(schema.exercises.archivedAt),
        ),
      )
      .returning(exerciseColumns);

    if (row) return toExercise(row);

    // Already in the requested state — re-read rather than throw.
    const [unchanged] = await db
      .select(exerciseColumns)
      .from(schema.exercises)
      .where(eq(schema.exercises.id, exerciseId))
      .limit(1);
    if (!unchanged)
      throw appError('EXERCISE_NOT_FOUND', 'That exercise is no longer available.', {});
    return toExercise(unchanged);
  });
}
