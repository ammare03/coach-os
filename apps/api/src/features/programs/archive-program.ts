import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `programs.archive` / `programs.unarchive` (`program-templates/03`).
// Ownership is `ownsResource('program', …)` in the router.
//
// A soft delete, not a real one (DB§2's general convention): archiving
// drops a program out of every listing query that filters
// `archived_at IS NULL` (`list-program-templates.ts`) without touching a
// row any client is already assigned to. It prevents NEW assignments, not
// in-progress ones — `assignment` (not yet built) is expected to resolve a
// client's access from the assignment row itself, never by re-checking the
// source program's `archived_at`.
//
// Both are plain, idempotent timestamp writes: archiving an already-archived
// program just re-stamps `archived_at`, and unarchiving one that was never
// archived is a no-op `SET NULL` — neither needs a pre-check.

export async function archiveProgram(db: DbClient, programId: string): Promise<void> {
  await db
    .update(schema.programs)
    .set({ archivedAt: new Date() })
    .where(eq(schema.programs.id, programId));
}

export async function unarchiveProgram(db: DbClient, programId: string): Promise<void> {
  await db
    .update(schema.programs)
    .set({ archivedAt: null })
    .where(eq(schema.programs.id, programId));
}
