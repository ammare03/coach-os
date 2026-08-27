// Revokes every live token in a refresh-token family (`04`) — the shared
// primitive reuse detection (here) and `05-sign-out-and-family-revocation.md`
// both call.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import { clearSessionCache } from '../../lib/auth/session-cache.ts';
import type { Context } from '../../trpc/context.ts';

export interface RevokeFamilyParams {
  /** The `audit_log` action — differs per caller: `'auth.refresh.reuse'` here, `'auth.signout'`/`'auth.signout_all'` in task 05. */
  auditAction: string;
  metadata?: Record<string, unknown>;
}

export interface RevokeFamilyResult {
  revokedCount: number;
}

/**
 * Revoke every row in `familyId` where `revoked_at IS NULL`, clear the
 * session cache for the affected user and device(s), write one `audit_log`
 * row, and be safe to call on an already-revoked family (`04`'s Produces
 * section, verbatim). The `UPDATE ... RETURNING` and the audit write commit
 * in one transaction; the cache clear runs after it commits, best-effort —
 * matching `open-session.ts`'s own ordering, and `04`'s Risks section:
 * "one transaction, one connection... must not contain a network call".
 *
 * Zero rows revoked (already fully revoked) writes nothing and clears
 * nothing — there is no new event to record, and no user/device to derive
 * from an empty result.
 */
export async function revokeFamily(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  familyId: string,
  params: RevokeFamilyParams,
): Promise<RevokeFamilyResult> {
  const revoked = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)),
      )
      .returning({ userId: schema.refreshTokens.userId, deviceId: schema.refreshTokens.deviceId });

    if (rows.length === 0) {
      return rows;
    }

    await writeAuditLog(tx, ctx, {
      action: params.auditAction,
      targetType: 'refresh_token_family',
      targetId: familyId,
      metadata: { ...params.metadata, revokedCount: rows.length },
    });

    return rows;
  });

  const first = revoked[0];
  if (first) {
    const deviceIds = [...new Set(revoked.map((row) => row.deviceId).filter((id) => id !== null))];
    if (deviceIds.length === 0) {
      await clearSessionCache(first.userId);
    } else {
      await Promise.all(deviceIds.map((deviceId) => clearSessionCache(first.userId, deviceId)));
    }
  }

  return { revokedCount: revoked.length };
}
