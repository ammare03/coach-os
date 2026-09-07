import { schema, type DbClient } from '@coachos/db';
import { eq, sql } from 'drizzle-orm';

// `training.programs.version` — a change-tracking counter, not a per-session
// pin. Every STRUCTURAL edit to a program's content (weeks, days, exercise
// blocks, targets, superset groups, alternatives) increments it, inside the
// SAME transaction as the write that earned it — never a trigger (DB§8.2).
// Cosmetic program metadata (`updateProgram`'s name/description/duration/
// isTemplate, `archiveProgram`/`unarchiveProgram`) never touches it. The
// full rationale, including why this project chose live-reference over
// snapshot, lives in `./versioning.md`.

/** The handle `db.transaction` hands its callback — a `DbClient` minus nesting. */
type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

/**
 * Increments `programs.version` by one. Called at the end of every
 * structural mutation, after the row(s) it counts have already been
 * written in the same transaction — never before, and never from a
 * standalone `db.transaction` of its own, or a crash between the two writes
 * could bump the counter with nothing behind it to justify the bump.
 */
export async function bumpProgramVersion(tx: DbTransaction, programId: string): Promise<void> {
  await tx
    .update(schema.programs)
    .set({ version: sql`${schema.programs.version} + 1` })
    .where(eq(schema.programs.id, programId));
}

/**
 * `program_weeks.program_id` is a direct column (DB§5.2) — no join needed.
 * Must be read BEFORE a delete of the week itself; the row that carries the
 * answer is the row about to disappear.
 */
export async function programIdForWeek(
  tx: DbTransaction,
  programWeekId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ programId: schema.programWeeks.programId })
    .from(schema.programWeeks)
    .where(eq(schema.programWeeks.id, programWeekId))
    .limit(1);
  return row?.programId ?? null;
}

/**
 * One join up from a day to its week's `program_id`. Same before-a-delete
 * rule as `programIdForWeek`.
 */
export async function programIdForDay(
  tx: DbTransaction,
  programDayId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ programId: schema.programWeeks.programId })
    .from(schema.programDays)
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .where(eq(schema.programDays.id, programDayId))
    .limit(1);
  return row?.programId ?? null;
}

/**
 * Two joins up from an exercise block to its program — the same chain
 * `../../trpc/authz/resource-registry.ts`'s `programExercise` entry walks
 * for ownership. Same before-a-delete rule as `programIdForWeek`.
 */
export async function programIdForExercise(
  tx: DbTransaction,
  programExerciseId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ programId: schema.programWeeks.programId })
    .from(schema.programExercises)
    .innerJoin(schema.programDays, eq(schema.programDays.id, schema.programExercises.programDayId))
    .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
    .where(eq(schema.programExercises.id, programExerciseId))
    .limit(1);
  return row?.programId ?? null;
}
