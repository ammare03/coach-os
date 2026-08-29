// `invites.revoke` (`05`) — the resolver itself. `ownsResource('invite', ...)`
// (`../../trpc/authz/resource-registry.ts`) has already confirmed, before
// this ever runs, that `inviteId` both exists and belongs to the calling
// coach — a coach can never reach this function with another coach's
// invite id, or one that was never real.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import type { Context } from '../../trpc/context.ts';

export async function revokeInvite(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  inviteId: string,
): Promise<void> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.id, inviteId))
    .limit(1);
  if (!invite) {
    // Not reachable via the tRPC procedure — `ownsResource` already refused
    // an unknown id with `NOT_YOUR_CLIENT` before this function runs.
    // Guarded anyway for the same reason `create-invite.ts`'s missing-coach
    // branch is: this function is also called directly from tests.
    throw appError(
      'INTERNAL_ERROR',
      'Something went wrong. Contact support with this reference.',
      {},
    );
  }

  // `05`'s Approach step 2: revoking an already-accepted invite would be a
  // no-op against the real client relationship, which by then exists
  // independently as a `client_profiles` row — reject with a clear code
  // rather than silently doing nothing.
  if (invite.acceptedAt) {
    throw appError(
      'INVITE_ALREADY_ACCEPTED',
      'This invite has already been used and cannot be revoked.',
      {},
    );
  }

  // Idempotent: a second revoke of an already-revoked invite is a no-op,
  // preserving the original `revoked_at` rather than overwriting it.
  if (invite.revokedAt) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.invites)
      .set({ revokedAt: new Date() })
      .where(eq(schema.invites.id, inviteId));
    await writeAuditLog(tx, ctx, {
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: inviteId,
    });
  });
}
