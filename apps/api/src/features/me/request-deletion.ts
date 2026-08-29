import { schema, type DbClient, type DeletionRequest } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

import { sendDeletionRecoveryEmail } from './send-deletion-recovery-email.ts';

/**
 * `me.requestDeletion` (`account-lifecycle/03`). Idempotent by construction
 * (Approach step 2): `ON CONFLICT (user_id) DO NOTHING` means a repeat call
 * while a request is already pending leaves the original `scheduledPurgeAt`
 * untouched — the row's `DEFAULT now() + interval '7 days'` (DATABASE.md's
 * `identity.deletion_requests`) only fires on the first insert, never a
 * conflict.
 */
export async function requestDeletion(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  email: string,
  timezone: string,
): Promise<DeletionRequest> {
  const request = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.deletionRequests)
      .values({ userId })
      .onConflictDoNothing({ target: schema.deletionRequests.userId })
      .returning();

    if (inserted) {
      // Only the row's actual creation is audited — a repeat call changed
      // nothing, and a second `account.deletion_requested` entry would
      // misrepresent how many times the account was actually flagged
      // (Acceptance criteria: repeated calls must not reset the window,
      // and an audit trail that implied otherwise would contradict that).
      await writeAuditLog(tx, ctx, {
        action: 'account.deletion_requested',
        targetType: 'user',
        targetId: userId,
      });
      return inserted;
    }

    const [existing] = await tx
      .select()
      .from(schema.deletionRequests)
      .where(eq(schema.deletionRequests.userId, userId));
    if (!existing) {
      // Unreachable: the conflict that just happened proves a row exists.
      throw new Error('requestDeletion: conflicting row vanished within the same transaction');
    }
    return existing;
  });

  // Sent on every call, not only the first (Approach step 3: "the recovery
  // email is sent regardless as a safety net") — off the response path,
  // same fire-and-forget shape as `invites/create-invite.ts`'s
  // `sendInviteEmail`.
  void sendDeletionRecoveryEmail(email, timezone, request.scheduledPurgeAt).catch(() => {});

  return request;
}
