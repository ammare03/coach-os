import { schema, type DbClient } from '@coachos/db';
import { and, desc, eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { bumpProgramVersion } from './program-version.ts';

// `programs.weeks.create` — the "Add week" ghost button
// (`program-builder/01`, frame 1a). Ownership is
// `ownsResource('program', …)` in the router.

/** `programs_duration_weeks_check` — the ceiling a week number shares. */
const MAX_WEEK_NUMBER = 104;

export interface CreateProgramWeekInput {
  programId: string;
  /** Omitted by the builder: the server appends one past the current last week. */
  weekNumber?: number | undefined;
  notes?: string | undefined;
}

/**
 * The duplicate check is a `SELECT` before the `INSERT`, inside the same
 * transaction, rather than a caught `23505`. Both are correct; this one can
 * name the week that collided in the error payload, and the stateless
 * database boundary cannot (`../../db/constraint-map.ts`'s own rule for
 * codes whose payload needs a value). `program_weeks_program_id_week_number_unique`
 * is still what guarantees it under a concurrent second request — the
 * pre-check is the good error, the index is the guarantee.
 */
export async function createProgramWeek(
  db: DbClient,
  input: CreateProgramWeekInput,
): Promise<{ id: string; weekNumber: number }> {
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ weekNumber: schema.programWeeks.weekNumber })
      .from(schema.programWeeks)
      .where(eq(schema.programWeeks.programId, input.programId))
      .orderBy(desc(schema.programWeeks.weekNumber))
      .limit(1);

    const weekNumber = input.weekNumber ?? (last ? last.weekNumber + 1 : 1);

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
          eq(schema.programWeeks.programId, input.programId),
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
      .values({
        programId: input.programId,
        weekNumber,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .returning({ id: schema.programWeeks.id });
    if (!week) throw new Error('insert into training.program_weeks did not return a row');

    // The declared length can never sit below an authored week — the
    // opposite of `updateProgram`'s refusal, and the reason that refusal is
    // the only place the two can ever disagree.
    const [program] = await tx
      .select({ durationWeeks: schema.programs.durationWeeks })
      .from(schema.programs)
      .where(eq(schema.programs.id, input.programId))
      .limit(1);
    if (program && program.durationWeeks < weekNumber) {
      await tx
        .update(schema.programs)
        .set({ durationWeeks: weekNumber })
        .where(eq(schema.programs.id, input.programId));
    }

    // Adding a week is structural (`./versioning.md`) — one bump for the
    // week that was actually added, whether or not it also raised the
    // program's declared length above.
    await bumpProgramVersion(tx, input.programId);

    return { id: week.id, weekNumber };
  });
}
