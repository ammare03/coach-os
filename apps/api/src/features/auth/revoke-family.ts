// The shared revocation primitive (`04`, generalised by `05`) — reuse
// detection, sign-out, sign-out-everywhere, a completed password reset,
// and an accepted account-deletion request all mean the same sentence:
// "these refresh tokens stop working now." One function, one behaviour,
// so none of the four drifts from the others.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import { clearSessionCache } from '../../lib/auth/session-cache.ts';
import type { Context } from '../../trpc/context.ts';

/**
 * Closed so the `audit_log` stays queryable ("how many sessions ended
 * because of reuse detection last month" is a question a free-text reason
 * can't answer, `05`'s Produces section) and so a caller can only ever ask
 * for one of the four things this product actually does, never invent a
 * fifth by typo.
 */
export type RevocationReason =
  'signout' | 'signout_all' | 'reuse' | 'password_reset' | 'account_deletion';

const AUDIT_ACTION_BY_REASON: Record<RevocationReason, string> = {
  signout: 'auth.signout',
  signout_all: 'auth.signout_all',
  reuse: 'auth.refresh.reuse',
  password_reset: 'auth.password_reset.revoke',
  account_deletion: 'account.deletion.revoke',
};

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
 * from an empty result (`05`'s Approach step 7: "return, do not revoke").
 */
export async function revokeFamily(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  familyId: string,
  reason: RevocationReason,
  metadata?: Record<string, unknown>,
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
      action: AUDIT_ACTION_BY_REASON[reason],
      targetType: 'refresh_token_family',
      targetId: familyId,
      metadata: { ...metadata, reason, revokedCount: rows.length },
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

export interface RevokeAllFamiliesResult {
  revokedCount: number;
  familyCount: number;
}

/**
 * Revokes every live family belonging to `userId` in one statement —
 * `auth.signOutAllDevices` (here), a completed password reset (`06`), and
 * an accepted account-deletion request (`../account-lifecycle/03`) all
 * call this rather than looping `revokeFamily` per family, which would be
 * one `audit_log` row per family instead of one row for the whole event
 * (`05`'s Produces section: "those three callers exist before this
 * function does; the signature is fixed here so they do not each invent
 * one").
 */
export async function revokeAllFamiliesForUser(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  reason: RevocationReason,
  metadata?: Record<string, unknown>,
): Promise<RevokeAllFamiliesResult> {
  const revoked = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)))
      .returning({ familyId: schema.refreshTokens.familyId });

    if (rows.length === 0) {
      return rows;
    }

    await writeAuditLog(tx, ctx, {
      action: AUDIT_ACTION_BY_REASON[reason],
      targetType: 'user',
      targetId: userId,
      actorUserId: userId,
      metadata: {
        ...metadata,
        reason,
        revokedCount: rows.length,
        familyCount: new Set(rows.map((row) => row.familyId)).size,
      },
    });

    return rows;
  });

  if (revoked.length > 0) {
    await clearSessionCache(userId); // every device — the whole point of "everywhere"
  }

  return {
    revokedCount: revoked.length,
    familyCount: new Set(revoked.map((row) => row.familyId)).size,
  };
}
