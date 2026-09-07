import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `programs.days.delete`. Ownership is `ownsResource('programDay', …)` in
// the router. `program_exercises` cascades from `program_days` (DB§5.2), so
// this takes the day's contents with it — see `deleteProgramWeek` for why a
// template row is deleted rather than archived.
export async function deleteProgramDay(db: DbClient, programDayId: string): Promise<void> {
  await db.delete(schema.programDays).where(eq(schema.programDays.id, programDayId));
}
