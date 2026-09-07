import { schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { copyDaysInto } from './copy-program-days.ts';

// `programs.days.duplicate` — the copy-to sheet's commit
// (`program-builder/06`, frame 1g). Ownership of BOTH the source day and
// the target week is established by the two `ownsResource` guards in the
// router; owning one says nothing about the other.

export interface DuplicateProgramDayInput {
  sourceDayId: string;
  targetWeekId: string;
  /** 1 (Monday) through 7 (Sunday) — a slot in the target week, not a list position. */
  targetDayNumber: number;
}

/**
 * One transaction, and that is the point of the task rather than a detail
 * of it: a day and every block beneath it either both land or neither
 * does. A mid-copy failure that left the day row behind would show a
 * complete-looking session in the builder with no exercises in it, which
 * is worse than the copy having failed outright.
 *
 * Every check runs before the first insert. The collision is refused by
 * name (`PROGRAM_DAY_TAKEN` carries the slot), not by letting
 * `program_days_program_week_id_day_number_unique` surface as a raw
 * constraint violation — the same pre-check-then-insert shape
 * `createProgramDay` uses, and for the same reason.
 */
export async function duplicateProgramDay(
  db: DbClient,
  input: DuplicateProgramDayInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // The source day and its program in one statement — the program is
    // what the target week has to match, and reading it separately would
    // be a second round trip for a fact this join already has.
    const [source] = await tx
      .select({ programId: schema.programWeeks.programId })
      .from(schema.programDays)
      .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
      .where(eq(schema.programDays.id, input.sourceDayId))
      .limit(1);
    // `ownsResource` has already established the row belongs to this
    // coach, so a null here is a row deleted between the guard's lookup
    // and this one — answered exactly as `programs.get` answers it, and
    // for the same reason (`ERRORS.md` ER§2.1).
    if (!source) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});

    const [targetWeek] = await tx
      .select({ programId: schema.programWeeks.programId })
      .from(schema.programWeeks)
      .where(eq(schema.programWeeks.id, input.targetWeekId))
      .limit(1);
    if (!targetWeek) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});

    // Both rows can be this coach's own and still not belong together.
    // Copying across programs is `program-templates`' territory, and doing
    // it quietly here because both guards happened to pass would be this
    // procedure performing an operation it does not offer.
    if (targetWeek.programId !== source.programId) {
      throw appError(
        'PROGRAM_COPY_CROSS_PROGRAM',
        'A day can only be copied into the same program.',
        {},
      );
    }

    const [occupied] = await tx
      .select({ id: schema.programDays.id })
      .from(schema.programDays)
      .where(
        and(
          eq(schema.programDays.programWeekId, input.targetWeekId),
          eq(schema.programDays.dayNumber, input.targetDayNumber),
        ),
      )
      .limit(1);
    if (occupied) {
      throw appError('PROGRAM_DAY_TAKEN', 'That day already has a session.', {
        dayNumber: input.targetDayNumber,
      });
    }

    const [copy] = await copyDaysInto(tx, [
      {
        sourceDayId: input.sourceDayId,
        targetWeekId: input.targetWeekId,
        targetDayNumber: input.targetDayNumber,
      },
    ]);
    if (!copy) throw new Error('copyDaysInto did not return the copied day');

    return { id: copy.copiedDayId };
  });
}
