import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `assignments.pause` (`assignment/01`) — one of the two resolutions the
// assign sheet offers when a client already has an active assignment
// (`CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`). A plain status write:
// `assignments_one_active`'s partial unique index only counts `active`
// rows, so moving this one off `active` is what frees the client for a new
// assignment — the same mechanism `archiveProgram`'s own comment describes
// for its index. Ownership is `ownsResource('assignment', …)` in the
// router. `assignment/05` owns automatic completion and week advance; this
// stays deliberately minimal.
export async function pauseAssignment(db: DbClient, assignmentId: string): Promise<void> {
  await db
    .update(schema.assignments)
    .set({ status: 'paused' })
    .where(eq(schema.assignments.id, assignmentId));
}
