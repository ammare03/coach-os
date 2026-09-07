import { schema, type DbClient, type Exercise } from '@coachos/db';
import { and, eq, inArray } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { visibleToCoach } from '../../services/exercises/visibility.ts';

// `programs.exercises.setAlternatives` — the commit at the bottom of the
// approved-swaps sheet (`program-builder/05`, frame 1f).
//
// **This resolver is the only integrity `program_exercises.alternatives`
// has.** Every other id column in DB§5.2 is a foreign key and Postgres
// refuses a bad one on our behalf; this one is a bare `uuid[]`, which
// `phase-01-data-layer/training-schema/02` flagged at the time as leaving
// application-layer integrity to this feature. There is no `RESTRICT` to
// fall back on and no constraint name to translate — if the check below is
// wrong or absent, the array holds whatever the caller sent.
//
// Ownership of the BLOCK is `ownsResource('programExercise', …)` in the
// router. The alternatives are library ids, and a library id is not an
// ownership question at all (`../../trpc/authz/resource-fields.ts` records
// the same reasoning for `exerciseId`) — it is a VISIBILITY question, and
// the two are checked by different means below.

export interface SetAlternativesInput {
  programExerciseId: string;
  alternativeExerciseIds: string[];
}

/**
 * One approved swap, as the coach's own sheet and the client's later swap
 * sheet both render it (`phase-09-workout-logger/session-modifications/02`
 * lists name and meta per row). Resolved server-side rather than returned
 * as bare ids, so neither surface has to issue a second query to learn what
 * it just saved (`UI-UX.md` §UX3).
 */
export type AlternativeExercise = Pick<Exercise, 'id' | 'name'>;

/** The handle `db.transaction` hands its callback — a `DbClient` minus nesting. */
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export async function setAlternatives(
  db: DbClient,
  coachProfileId: string,
  input: SetAlternativesInput,
): Promise<{ alternatives: AlternativeExercise[] }> {
  return db.transaction(async (tx) => {
    // `FOR UPDATE`, so two devices editing the same block's swap list
    // serialise here rather than both writing a whole picture over each
    // other's. The row's own `exercise_id` is read in the same statement
    // because the self-reference rule below is a fact about this block,
    // not about the ids the caller sent.
    const [block] = await tx
      .select({
        id: schema.programExercises.id,
        exerciseId: schema.programExercises.exerciseId,
      })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.id, input.programExerciseId))
      .limit(1)
      .for('update');

    // `ownsResource` has already established the block belongs to this
    // coach, so a null here is a row deleted between the guard's lookup and
    // this one. `NOT_YOUR_CLIENT` rather than a distinct "no such block":
    // the two must stay byte-identical or the pair becomes an existence
    // oracle (`ERRORS.md` ER§2.1) — the same answer `programs.days.get`
    // gives, for the same reason.
    if (!block) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});

    // An exercise is not an alternative to itself, and a swap list that
    // offers the movement the client is already looking at is a swap list
    // with one dead row in it. The sheet renders that row dimmed, badged
    // "This one" and without a checkbox, so this is the floor under a
    // stale client rather than the normal path.
    if (input.alternativeExerciseIds.includes(block.exerciseId)) {
      throw appError(
        'PROGRAM_ALTERNATIVE_IS_ORIGIN',
        'An exercise cannot be a swap for itself.',
        {},
      );
    }

    // **The whole security surface of this feature, in one query.**
    //
    // Two questions, deliberately answered together and deliberately
    // answered the same way:
    //
    //   1. *Existence.* The column has no foreign key, so an id naming
    //      nothing would be written and would surface later as a swap the
    //      client's sheet cannot render (`MEDIA_EXPIRED`'s shape, for
    //      exercises). One `IN (…)` over the whole array, and a short
    //      answer refuses the WHOLE write — never a partial one, because a
    //      partially-approved list is a list the coach did not approve.
    //
    //   2. *Visibility.* `visibleToCoach` is the global library plus this
    //      caller's own custom rows and nothing else — the same predicate
    //      `exercises.search`, `exercises.list` and `createProgramExercise`
    //      compose, resolved from the SESSION and never from anything the
    //      caller sends (`../../services/exercises/visibility.ts`). Without
    //      it a coach could plant another coach's custom exercise id here
    //      and read that exercise's name and cues straight back out of
    //      their own client's swap sheet. It is the same rule and not a
    //      second definition of "visible", which is the point: a second
    //      definition is a second thing to keep in step.
    //
    // Both failures answer `EXERCISE_NOT_FOUND`, indistinguishably. A
    // distinct code for the second would confirm that row exists and hand
    // back the enumeration oracle `exercises.get` closes (`ERRORS.md`
    // ER§2.1).
    if (input.alternativeExerciseIds.length > 0) {
      const visible = await tx
        .select({ id: schema.exercises.id })
        .from(schema.exercises)
        .where(
          and(
            inArray(schema.exercises.id, input.alternativeExerciseIds),
            visibleToCoach(coachProfileId),
          ),
        );

      // Distinctness is the schema's (`packages/schemas`' object-level
      // refinement), so a count comparison is exact here: every id
      // resolved, or the write does not happen.
      if (visible.length !== input.alternativeExerciseIds.length) {
        throw appError('EXERCISE_NOT_FOUND', "We couldn't find one of those exercises.", {});
      }
    }

    await tx
      .update(schema.programExercises)
      // The coach's own order, preserved — the chips read back in the
      // order they were approved, and the client's swap sheet lists them
      // the same way. Postgres holds a `uuid[]` in the order given.
      .set({ alternatives: input.alternativeExerciseIds })
      .where(eq(schema.programExercises.id, input.programExerciseId));

    return { alternatives: await readBack(tx, input.alternativeExerciseIds) };
  });
}

/**
 * The saved list as the database actually holds it, resolved to names —
 * read back rather than echoed, so the client reconciles against server
 * truth and not against the guess it rendered optimistically (the bargain
 * `setSupersetGroup` and `reorder` both make).
 *
 * Ordered by the caller's array rather than by the query, because
 * `IN (…)` has no order of its own and the coach's order is the one the
 * chips and the client's swap sheet both show.
 */
async function readBack(
  tx: DbTransaction,
  alternativeExerciseIds: string[],
): Promise<AlternativeExercise[]> {
  if (alternativeExerciseIds.length === 0) return [];

  const rows = await tx
    .select({ id: schema.exercises.id, name: schema.exercises.name })
    .from(schema.exercises)
    .where(inArray(schema.exercises.id, alternativeExerciseIds));

  const byId = new Map(rows.map((row) => [row.id, row]));
  return alternativeExerciseIds
    .map((id) => byId.get(id))
    .filter((row): row is AlternativeExercise => row !== undefined);
}
