import { schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { bumpProgramVersion, programIdForWeek } from './program-version.ts';

// `programs.days.create` — the "Add day" ghost row inside a week card
// (`program-builder/01`, frame 1a). Ownership is
// `ownsResource('programWeek', …)` in the router.

export interface CreateProgramDayInput {
  programWeekId: string;
  /** 1 (Monday) through 7 (Sunday) — a slot in the week, not a list position. */
  dayNumber: number;
  name: string;
  isRestDay?: boolean | undefined;
  notes?: string | undefined;
}

/**
 * The add-day sheet renders all seven slots and makes the taken ones inert,
 * so a coach cannot select this collision in the first place. This check is
 * what holds when the client is stale or two devices race — the same
 * pre-check-then-insert shape `createProgramWeek` uses, and for the same
 * reason: `program_days_program_week_id_day_number_unique` guarantees it,
 * this names the day that collided.
 */
export async function createProgramDay(
  db: DbClient,
  input: CreateProgramDayInput,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.programDays.id })
      .from(schema.programDays)
      .where(
        and(
          eq(schema.programDays.programWeekId, input.programWeekId),
          eq(schema.programDays.dayNumber, input.dayNumber),
        ),
      )
      .limit(1);
    if (existing) {
      throw appError('PROGRAM_DAY_TAKEN', 'That day already has a session.', {
        dayNumber: input.dayNumber,
      });
    }

    const [day] = await tx
      .insert(schema.programDays)
      .values({
        programWeekId: input.programWeekId,
        dayNumber: input.dayNumber,
        name: input.name,
        ...(input.isRestDay !== undefined ? { isRestDay: input.isRestDay } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .returning({ id: schema.programDays.id });
    if (!day) throw new Error('insert into training.program_days did not return a row');

    const programId = await programIdForWeek(tx, input.programWeekId);
    if (programId) await bumpProgramVersion(tx, programId);

    return { id: day.id };
  });
}
