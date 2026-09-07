import { schema, type DbClient } from '@coachos/db';
import { asc, eq, inArray } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { copyDaysInto, type DayCopyTarget } from './copy-program-days.ts';

// `programs.duplicate` — the whole-program copy (`program-templates/02`),
// built directly on `copyDaysInto` (`program-builder/06`) rather than
// reimplementing the deep-copy: `copyDaysInto` already carries every
// `program_exercises` column, generates fresh ids, and takes a target week
// id with no same-program assumption baked in, so no generalisation of it
// was needed to reach across programs. `duplicateProgramDay`/
// `duplicateProgramWeek` are left untouched — their own within-program
// collision checks (`PROGRAM_DAY_TAKEN`, `PROGRAM_WEEK_EXISTS`, the append-
// past-last-week numbering) don't apply here, since every target here is a
// brand-new program with nothing to collide with.

export interface DuplicateProgramInput {
  sourceProgramId: string;
  newName: string;
}

/**
 * One transaction over the whole hierarchy: the new program row, every
 * week, every day and every block land together or not at all — the same
 * guarantee `duplicateProgramWeek` makes for one week, extended across an
 * entire program so a mid-copy failure never leaves a program that looks
 * complete in the library but is missing weeks.
 *
 * Every insert here is batched (`code-conventions` §7 — no query inside a
 * loop): one insert for every copied week, one `inArray` select for every
 * day under all of them, and one `copyDaysInto` call for every block on
 * every one of those days, regardless of how many weeks the source program
 * has.
 */
export async function duplicateProgram(
  db: DbClient,
  coachProfileId: string,
  input: DuplicateProgramInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({
        durationWeeks: schema.programs.durationWeeks,
        isTemplate: schema.programs.isTemplate,
        description: schema.programs.description,
      })
      .from(schema.programs)
      .where(eq(schema.programs.id, input.sourceProgramId))
      .limit(1);
    // `ownsResource` already established this coach owns the row; a null
    // here is one deleted between that lookup and this one — answered as
    // `programs.get` answers it (`ERRORS.md` ER§2.1).
    if (!source) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});

    const [program] = await tx
      .insert(schema.programs)
      .values({
        coachId: coachProfileId,
        name: input.newName,
        description: source.description,
        durationWeeks: source.durationWeeks,
        // Matches the source by default (`program-templates/02`'s Approach
        // §3) — `programs.update`'s toggle is how a coach changes it after.
        isTemplate: source.isTemplate,
      })
      .returning({ id: schema.programs.id });
    if (!program) throw new Error('insert into training.programs did not return a row');

    const sourceWeeks = await tx
      .select({
        id: schema.programWeeks.id,
        weekNumber: schema.programWeeks.weekNumber,
        notes: schema.programWeeks.notes,
      })
      .from(schema.programWeeks)
      .where(eq(schema.programWeeks.programId, input.sourceProgramId))
      .orderBy(asc(schema.programWeeks.weekNumber));

    if (sourceWeeks.length === 0) return { id: program.id };

    // Every week keeps its own number: a copy is the same mesocycle, not a
    // renumbered one, so a source with weeks 1, 2 and 5 copies to exactly
    // 1, 2 and 5 rather than being compacted to 1, 2, 3.
    const insertedWeeks = await tx
      .insert(schema.programWeeks)
      .values(
        sourceWeeks.map((week) => ({
          programId: program.id,
          weekNumber: week.weekNumber,
          notes: week.notes,
        })),
      )
      .returning({ id: schema.programWeeks.id, weekNumber: schema.programWeeks.weekNumber });

    // Matched back by `week_number` (unique per program, DB§5.2), not by
    // VALUES order — the same reason `copyDaysInto` matches its own
    // inserted rows by slot rather than position.
    const targetWeekIdByNumber = new Map(insertedWeeks.map((week) => [week.weekNumber, week.id]));
    const weekNumberBySourceWeekId = new Map(sourceWeeks.map((week) => [week.id, week.weekNumber]));

    const sourceWeekIds = sourceWeeks.map((week) => week.id);
    const sourceDays = await tx
      .select({
        id: schema.programDays.id,
        programWeekId: schema.programDays.programWeekId,
        dayNumber: schema.programDays.dayNumber,
      })
      .from(schema.programDays)
      .where(inArray(schema.programDays.programWeekId, sourceWeekIds));

    const targets: DayCopyTarget[] = sourceDays.map((day) => {
      const weekNumber = weekNumberBySourceWeekId.get(day.programWeekId);
      const targetWeekId =
        weekNumber !== undefined ? targetWeekIdByNumber.get(weekNumber) : undefined;
      if (!targetWeekId) {
        throw new Error(`duplicateProgram: no copied week for source week ${day.programWeekId}`);
      }
      return { sourceDayId: day.id, targetWeekId, targetDayNumber: day.dayNumber };
    });

    await copyDaysInto(tx, targets);

    return { id: program.id };
  });
}
