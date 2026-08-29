import { schema, type DbClient } from '@coachos/db';
import { lte } from 'drizzle-orm';

import { enqueuePurgeAccount } from '../queues/enqueue.ts';

/**
 * `account-lifecycle/04`'s scheduled sweep — scans `identity.deletion_requests`
 * for rows whose 7-day grace period has elapsed and enqueues `purgeAccount`
 * for each. Never purges directly, and never checks whether a row is
 * "already enqueued" itself: `enqueuePurgeAccount`'s `purge.{userId}`
 * `jobId` (`../queues/enqueue.ts`) is what makes re-running this sweep
 * safe on every interval — a row still past due on the next run is a
 * no-op re-enqueue against an already-queued or already-running job, and a
 * row whose purge already completed is simply gone from this table
 * (cascaded away with the rest of the account via `deletion_requests.user_id
 * ON DELETE CASCADE`), so this sweep never sees it again either.
 *
 * The scheduling mechanism itself (a BullMQ repeatable job, a cron
 * trigger) is out of this task's scope (its own Scope section) — this is
 * the job logic a later phase's scheduler calls, not the scheduler.
 */
export async function sweepDeletionRequests(db: DbClient): Promise<number> {
  const due = await db
    .select({ userId: schema.deletionRequests.userId })
    .from(schema.deletionRequests)
    .where(lte(schema.deletionRequests.scheduledPurgeAt, new Date()));

  for (const row of due) {
    await enqueuePurgeAccount({ userId: row.userId });
  }

  return due.length;
}
