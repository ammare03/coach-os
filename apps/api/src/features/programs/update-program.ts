import { schema, type DbClient } from '@coachos/db';
import { desc, eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';

// `programs.update` — the details sheet (`program-builder/01`, frame 1h):
// name, notes, and length. Ownership is `ownsResource('program', …)` in the
// router.

export interface UpdateProgramInput {
  programId: string;
  name?: string | undefined;
  /** `null` clears the notes; an absent key leaves them alone. */
  description?: string | null | undefined;
  durationWeeks?: number | undefined;
}

/**
 * `duration_weeks` is the program's declared length, and the weeks actually
 * written are what a coach has authored inside it — the two are allowed to
 * differ upward (a 12-week plan with 3 weeks written so far) but never
 * downward. Shrinking below the last authored week would leave weeks 9-12
 * unreachable from every screen while their rows, and their exercises,
 * stayed in the database. Refusing is the only answer that neither lies nor
 * deletes the coach's work; the copy tells them which weeks are in the way.
 */
export async function updateProgram(db: DbClient, input: UpdateProgramInput): Promise<void> {
  const { programId, ...changes } = input;
  const hasChange =
    changes.name !== undefined ||
    changes.description !== undefined ||
    changes.durationWeeks !== undefined;
  // `updated_at` is maintained by DB§8.1's trigger, never set here — an
  // empty `.set()` would also be a Drizzle error, so this returns first.
  if (!hasChange) return;

  await db.transaction(async (tx) => {
    if (changes.durationWeeks !== undefined) {
      const [last] = await tx
        .select({ weekNumber: schema.programWeeks.weekNumber })
        .from(schema.programWeeks)
        .where(eq(schema.programWeeks.programId, programId))
        .orderBy(desc(schema.programWeeks.weekNumber))
        .limit(1);

      if (last && last.weekNumber > changes.durationWeeks) {
        throw appError(
          'PROGRAM_DURATION_TOO_SHORT',
          'This program already has more weeks than that.',
          { weekCount: last.weekNumber },
        );
      }
    }

    await tx
      .update(schema.programs)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.durationWeeks !== undefined ? { durationWeeks: changes.durationWeeks } : {}),
      })
      .where(eq(schema.programs.id, programId));
  });
}
