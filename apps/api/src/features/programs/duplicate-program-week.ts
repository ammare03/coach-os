import { schema, type DbClient } from '@coachos/db';
import { and, asc, desc, eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { copyDaysInto } from './copy-program-days.ts';
import { bumpProgramVersion } from './program-version.ts';

// `programs.weeks.duplicate` — "Duplicate whole week" in the week kebab
// (`program-builder/06`, frame 1g). Ownership is
// `ownsResource('programWeek', …)` in the router, and one guard is enough:
// the destination is a week NUMBER inside the source week's own program,
// so there is no second row to own.

/** `programs_duration_weeks_check` — the ceiling a week number shares (`createProgramWeek`). */
const MAX_WEEK_NUMBER = 104;

export interface DuplicateProgramWeekInput {
  sourceWeekId: string;
  /** Omitted by the menu: the server appends one past the program's current last week. */
  targetWeekNumber?: number | undefined;
}

/**
 * One transaction over the whole week — the week row, all of its days, and
 * every block on every one of them. This is the risk the task exists to
 * close: a partially copied week looks complete in the builder (a week
 * card with day rows under it) while some of those days are silently
 * empty, and a coach only finds out when a client opens the session.
 *
 * Composed from `copyDaysInto`, the same primitive
 * `duplicateProgramDay` uses, so "a week copies the way a day does" is one
 * code path rather than two that have to be kept in agreement.
 *
 * `duration_weeks` is the program's DECLARED length and may never sit
 * below an authored week (`program-builder/01`), so a copy that lands past
 * the end drags it up — exactly what `createProgramWeek` does when "Add
 * week" appends past it.
 */
export async function duplicateProgramWeek(
  db: DbClient,
  input: DuplicateProgramWeekInput,
): Promise<{ id: string; weekNumber: number; dayCount: number }> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({
        programId: schema.programWeeks.programId,
        weekNumber: schema.programWeeks.weekNumber,
        notes: schema.programWeeks.notes,
      })
      .from(schema.programWeeks)
      .where(eq(schema.programWeeks.id, input.sourceWeekId))
      .limit(1);
    // Deleted between the guard's lookup and this one — answered as
    // `programs.get` answers it (`ERRORS.md` ER§2.1).
    if (!source) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});

    const [last] = await tx
      .select({ weekNumber: schema.programWeeks.weekNumber })
      .from(schema.programWeeks)
      .where(eq(schema.programWeeks.programId, source.programId))
      .orderBy(desc(schema.programWeeks.weekNumber))
      .limit(1);

    const weekNumber = input.targetWeekNumber ?? (last ? last.weekNumber + 1 : 1);

    if (weekNumber > MAX_WEEK_NUMBER) {
      throw appError('PROGRAM_WEEK_LIMIT_REACHED', 'A program can run for 104 weeks at most.', {
        maxWeeks: MAX_WEEK_NUMBER,
      });
    }

    const [existing] = await tx
      .select({ id: schema.programWeeks.id })
      .from(schema.programWeeks)
      .where(
        and(
          eq(schema.programWeeks.programId, source.programId),
          eq(schema.programWeeks.weekNumber, weekNumber),
        ),
      )
      .limit(1);
    if (existing) {
      throw appError('PROGRAM_WEEK_EXISTS', 'That week is already in this program.', {
        weekNumber,
      });
    }

    const [week] = await tx
      .insert(schema.programWeeks)
      .values({ programId: source.programId, weekNumber, notes: source.notes })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('insert into training.program_weeks did not return a row');

    // Every day keeps the slot it had. A copied week is the same training
    // week one week later, so Monday stays Monday — renumbering the days
    // would be inventing a schedule the coach did not write.
    const sourceDays = await tx
      .select({ id: schema.programDays.id, dayNumber: schema.programDays.dayNumber })
      .from(schema.programDays)
      .where(eq(schema.programDays.programWeekId, input.sourceWeekId))
      .orderBy(asc(schema.programDays.dayNumber));

    await copyDaysInto(
      tx,
      sourceDays.map((day) => ({
        sourceDayId: day.id,
        targetWeekId: week.id,
        targetDayNumber: day.dayNumber,
      })),
    );

    const [program] = await tx
      .select({ durationWeeks: schema.programs.durationWeeks })
      .from(schema.programs)
      .where(eq(schema.programs.id, source.programId))
      .limit(1);
    if (program && program.durationWeeks < weekNumber) {
      await tx
        .update(schema.programs)
        .set({ durationWeeks: weekNumber })
        .where(eq(schema.programs.id, source.programId));
    }

    // One bump for the week that was duplicated in, same as `createProgramWeek`.
    await bumpProgramVersion(tx, source.programId);

    return { id: week.id, weekNumber, dayCount: sourceDays.length };
  });
}
