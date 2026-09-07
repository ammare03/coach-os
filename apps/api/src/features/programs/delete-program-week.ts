import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { bumpProgramVersion, programIdForWeek } from './program-version.ts';

// `programs.weeks.delete`. Ownership is `ownsResource('programWeek', …)` in
// the router.
//
// A real delete, not an archive: `program_days` and `program_exercises`
// cascade from `program_weeks` (DB§5.2), and a template week nobody has
// trained against has no history to preserve. The reversal is
// `ui-conventions` §5's undo window on the client, which defers this call
// rather than reversing it.
export async function deleteProgramWeek(db: DbClient, programWeekId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Read before the delete — this is the row that carries the answer,
    // and it will be gone once the delete below runs.
    const programId = await programIdForWeek(tx, programWeekId);

    await tx.delete(schema.programWeeks).where(eq(schema.programWeeks.id, programWeekId));

    // `null` only if the week was already gone (deleted by a racing
    // request) — nothing left to bump a version on.
    if (programId) await bumpProgramVersion(tx, programId);
  });
}
