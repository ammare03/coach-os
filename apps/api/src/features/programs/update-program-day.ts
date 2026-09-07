import { schema, type DbClient } from '@coachos/db';
import { and, eq, ne } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

import { bumpProgramVersion, programIdForDay } from './program-version.ts';

// `programs.days.update` — rename a day, move it to another slot in its own
// week, or flip it to a rest day. Ownership is
// `ownsResource('programDay', …)` in the router.

export interface UpdateProgramDayInput {
  programDayId: string;
  dayNumber?: number | undefined;
  name?: string | undefined;
  isRestDay?: boolean | undefined;
  /** `null` clears the notes; an absent key leaves them alone. */
  notes?: string | null | undefined;
}

export async function updateProgramDay(db: DbClient, input: UpdateProgramDayInput): Promise<void> {
  const { programDayId, ...changes } = input;
  const hasChange =
    changes.dayNumber !== undefined ||
    changes.name !== undefined ||
    changes.isRestDay !== undefined ||
    changes.notes !== undefined;
  // `updated_at` is maintained by DB§8.1's trigger, so there is nothing to
  // write when nothing changed — and an empty `.set()` is a Drizzle error.
  if (!hasChange) return;

  await db.transaction(async (tx) => {
    if (changes.dayNumber !== undefined) {
      // Moving a day is scoped to its OWN week — reading the week id from
      // the row rather than accepting one, so a caller cannot move a day
      // into a week `ownsResource` never checked.
      const [current] = await tx
        .select({ programWeekId: schema.programDays.programWeekId })
        .from(schema.programDays)
        .where(eq(schema.programDays.id, programDayId))
        .limit(1);
      if (!current) return;

      const [clash] = await tx
        .select({ id: schema.programDays.id })
        .from(schema.programDays)
        .where(
          and(
            eq(schema.programDays.programWeekId, current.programWeekId),
            eq(schema.programDays.dayNumber, changes.dayNumber),
            ne(schema.programDays.id, programDayId),
          ),
        )
        .limit(1);
      if (clash) {
        throw appError('PROGRAM_DAY_TAKEN', 'That day already has a session.', {
          dayNumber: changes.dayNumber,
        });
      }
    }

    // Resolved before the write, not after: an update never removes the
    // row, but reading against the pre-write state keeps this call
    // identical in shape to `deleteProgramDay`'s before-a-delete rule
    // (`./program-version.ts`), rather than two different conventions for
    // "when do I look up the owning program."
    const programId = await programIdForDay(tx, programDayId);

    await tx
      .update(schema.programDays)
      .set({
        ...(changes.dayNumber !== undefined ? { dayNumber: changes.dayNumber } : {}),
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.isRestDay !== undefined ? { isRestDay: changes.isRestDay } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      })
      .where(eq(schema.programDays.id, programDayId));

    // A day's own name, slot and notes are authored session content
    // (`./versioning.md`), unlike the program-level metadata sheet
    // `updateProgram` writes — every field this procedure can change
    // counts as structural.
    if (programId) await bumpProgramVersion(tx, programId);
  });
}
