import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

// `assignments.complete` (`assignment/01`) — the other resolution the
// assign sheet offers on `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`. Same
// mechanism as `pauseAssignment`: moving the row off `active` frees
// `assignments_one_active` for a new one. `completed_at` is set here
// because this is the one manual path to `status = 'completed'` before
// `assignment/05` builds the automatic one — both paths write the same two
// columns, so a later reader can't tell them apart, which is intentional.
export async function completeAssignment(db: DbClient, assignmentId: string): Promise<void> {
  await db
    .update(schema.assignments)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(schema.assignments.id, assignmentId));
}
