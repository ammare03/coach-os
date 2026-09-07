import { schema, type DbClient, type ProgramExercise } from '@coachos/db';
import { programs as programsSchemas } from '@coachos/schemas';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { bumpProgramVersion, programIdForDay } from './program-version.ts';

// `programs.exercises.setSupersetGroup` — the commit at the bottom of
// selection mode, and the "Ungroup A" chip attached to a group
// (`program-builder/04`, frame 1e).
//
// Ownership of the DAY and of every id in `exerciseIds` is established by
// the two `ownsResource` guards in the router. What is checked here is
// everything ownership cannot answer: that those ids are blocks of THIS
// day, that a grouping is two or more of them standing next to each other,
// and that the letter the client picked is still free.

export interface SetSupersetGroupInput {
  programDayId: string;
  exerciseIds: string[];
  group: string | null;
}

/** The one column this procedure writes, read back for the client to reconcile against. */
export type GroupedProgramExercise = Pick<ProgramExercise, 'id' | 'supersetGroup'>;

/** The handle `db.transaction` hands its callback — a `DbClient` minus nesting. */
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

const { minSupersetMembers, maxSupersetGroupsPerDay } = programsSchemas.PROGRAM_BOUNDS;

/**
 * The letters that occupy one unbroken run in the given order.
 *
 * A superset means back-to-back execution (`CLAUDE.md` §26), so a group
 * split across the day is data that contradicts its own meaning. This
 * answers "which groups currently hold together", and callers compare the
 * before and after of a write rather than demanding contiguity outright —
 * a day that somehow already holds a split group must still be reorderable,
 * or one bad row locks the whole day forever.
 */
export function contiguousGroups(groups: readonly (string | null)[]): Set<string> {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const size = new Map<string, number>();
  groups.forEach((group, index) => {
    if (group === null) return;
    if (!first.has(group)) first.set(group, index);
    last.set(group, index);
    size.set(group, (size.get(group) ?? 0) + 1);
  });

  const contiguous = new Set<string>();
  for (const [group, start] of first) {
    const end = last.get(group) ?? start;
    if (end - start + 1 === size.get(group)) contiguous.add(group);
  }
  return contiguous;
}

export async function setSupersetGroup(
  db: DbClient,
  input: SetSupersetGroupInput,
): Promise<{ exercises: GroupedProgramExercise[] }> {
  return db.transaction(async (tx) => {
    // `FOR UPDATE`, and ordered, for the same two reasons `reorder` takes
    // both: two devices grouping the same day serialise here rather than
    // racing for a letter, and adjacency is a question about the day's
    // order, so the order has to be read rather than assumed.
    const current = await tx
      .select({
        id: schema.programExercises.id,
        supersetGroup: schema.programExercises.supersetGroup,
      })
      .from(schema.programExercises)
      .where(eq(schema.programExercises.programDayId, input.programDayId))
      .orderBy(asc(schema.programExercises.orderIndex))
      .for('update');

    const usedGroups = new Set(
      current.map((row) => row.supersetGroup).filter((group): group is string => group !== null),
    );
    const positionOf = new Map(current.map((row, index) => [row.id, index]));
    const groupOf = new Map(current.map((row) => [row.id, row.supersetGroup]));

    // One answer for every way the client's picture can be out of date: an
    // id that is not on this day (including one on ANOTHER day of the same
    // coach's own program, which `ownsResource` happily allows through), a
    // block deleted since the read, or — when grouping — a block already
    // carrying a letter. The recovery is identical in all of them: refresh
    // and group again. A block belonging to another COACH never reaches
    // here; `ownsResource` refuses the whole call first.
    const stale = (): Error =>
      appError(
        'PROGRAM_SUPERSET_STALE',
        'This day changed somewhere else, so the grouping was not saved.',
        { groupCount: usedGroups.size },
      );
    if (input.exerciseIds.some((id) => !positionOf.has(id))) throw stale();

    if (input.group !== null) {
      // Selection mode offers a checkbox only on an ungrouped block, so a
      // block that already carries a letter arriving here is the same
      // stale picture — never a request to move it between groups.
      if (input.exerciseIds.some((id) => groupOf.get(id) !== null)) throw stale();

      // The ceiling, checked BEFORE the letter, so running out of alphabet
      // says so in its own words instead of arriving as "that letter is
      // taken" — which would be true, and useless.
      if (usedGroups.size >= maxSupersetGroupsPerDay) {
        throw appError(
          'PROGRAM_SUPERSET_LIMIT_REACHED',
          `A day can hold ${maxSupersetGroupsPerDay} supersets. Ungroup one to make another.`,
          { maxGroups: maxSupersetGroupsPerDay },
        );
      }
      if (usedGroups.has(input.group)) throw stale();

      // Two or more, and consecutive. Both are the same product rule seen
      // from two directions (`CLAUDE.md` §26), so both carry one code and
      // one sentence. The UI prevents each — the commit button is inert
      // below two selections and inert again when the selection has a gap
      // in it — so this is the floor under a stale or patched client.
      const positions = [...input.exerciseIds]
        .map((id) => positionOf.get(id) ?? -1)
        .sort((a, b) => a - b);
      const lowest = positions[0] ?? 0;
      const highest = positions[positions.length - 1] ?? 0;
      const isConsecutiveRun =
        positions.length >= minSupersetMembers && highest - lowest === positions.length - 1;
      if (!isConsecutiveRun) {
        throw appError(
          'PROGRAM_SUPERSET_NOT_ADJACENT',
          'A superset is 2 or more exercises, one straight after the other.',
          { exerciseCount: positions.length },
        );
      }
    }

    await tx
      .update(schema.programExercises)
      .set({ supersetGroup: input.group })
      .where(
        and(
          eq(schema.programExercises.programDayId, input.programDayId),
          inArray(schema.programExercises.id, input.exerciseIds),
        ),
      );

    // Grouping and ungrouping are both structural (`./versioning.md`).
    const programId = await programIdForDay(tx, input.programDayId);
    if (programId) await bumpProgramVersion(tx, programId);

    return { exercises: await readBack(tx, input.programDayId) };
  });
}

/**
 * The whole day's grouping as the database actually holds it — read back
 * rather than echoed, so the client reconciles against server truth and not
 * against the guess it rendered optimistically.
 */
async function readBack(
  tx: DbTransaction,
  programDayId: string,
): Promise<GroupedProgramExercise[]> {
  return tx
    .select({
      id: schema.programExercises.id,
      supersetGroup: schema.programExercises.supersetGroup,
    })
    .from(schema.programExercises)
    .where(eq(schema.programExercises.programDayId, programDayId))
    .orderBy(asc(schema.programExercises.orderIndex));
}
