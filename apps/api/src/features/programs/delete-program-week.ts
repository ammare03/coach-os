import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `programs.weeks.delete`. Ownership is `ownsResource('programWeek', …)` in
// the router.
//
// A real delete, not an archive: `program_days` and `program_exercises`
// cascade from `program_weeks` (DB§5.2), and a template week nobody has
// trained against has no history to preserve. The reversal is
// `ui-conventions` §5's undo window on the client, which defers this call
// rather than reversing it.
export async function deleteProgramWeek(db: DbClient, programWeekId: string): Promise<void> {
  await db.delete(schema.programWeeks).where(eq(schema.programWeeks.id, programWeekId));
}
