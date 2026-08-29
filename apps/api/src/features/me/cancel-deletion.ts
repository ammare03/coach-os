import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

/**
 * `me.cancelDeletion` (`account-lifecycle/03`) — the recovery path, reached
 * identically from the email link or directly in the app (Approach step 3:
 * neither is privileged over the other, since both resolve to the same
 * authenticated caller). Idempotent: deleting zero rows (nothing pending,
 * or a second call) is a quiet no-op, never an error — there is no
 * meaningfully different outcome to report either way.
 */
export async function cancelDeletion(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.deletionRequests)
      .where(eq(schema.deletionRequests.userId, userId))
      .returning({ userId: schema.deletionRequests.userId });

    if (deleted.length > 0) {
      await writeAuditLog(tx, ctx, {
        action: 'account.deletion_cancelled',
        targetType: 'user',
        targetId: userId,
      });
    }
  });
}
