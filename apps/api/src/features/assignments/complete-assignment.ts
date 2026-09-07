import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { discardOrphanedScheduledSessions } from './advance-assignment.ts';

// `assignments.complete` (`assignment/01`) — the other resolution the
// assign sheet offers on `CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT`. Same
// mechanism as `pauseAssignment`: moving the row off `active` frees
// `assignments_one_active` for a new one. `completed_at` is set here
// because this is the one manual path to `status = 'completed'` before
// `assignment/05` built the automatic one (`./advance-assignment.ts`) —
// both paths write the same two columns, so a later reader can't tell them
// apart, which is intentional.
//
// `assignment/05` extends this with a transaction: completing a program
// early (a coach calling this while the client still has weeks of
// materialised `'scheduled'` sessions left) must not leave those sessions
// dangling under a program the client is no longer following —
// `discardOrphanedScheduledSessions` (decision (c),
// `./advance-assignment.ts`'s header) soft-deletes them in the SAME
// transaction as the status write, so the two can never disagree.
export async function completeAssignment(db: DbClient, assignmentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.assignments)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(schema.assignments.id, assignmentId));
    await discardOrphanedScheduledSessions(tx, assignmentId);
  });
}
