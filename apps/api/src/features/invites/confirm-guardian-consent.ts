// `invites.confirmGuardianConsent` (`guardian-consent/02`) — the moment a
// 13-17 client's account becomes real: `users.guardian_consent_at` gets a
// timestamp and their `client_profiles` row moves from `'invited'` to
// `'active'`, in one transaction.
//
// Returns a discriminated outcome rather than throwing for the three states
// a guardian can legitimately reach. This is the one place in the codebase
// where a "failure" is rendered to a non-user in a browser (`05`'s public
// page needs three visibly different pages), and a replayed link — a parent
// forwarding the email to the other parent, or clicking twice — is the
// ordinary case, not an attack.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import {
  consumeGuardianConsentToken,
  hashGuardianConsentToken,
  storeGuardianConsentToken,
} from '../../lib/auth/guardian-consent-token.ts';
import { logger } from '../../lib/logger.ts';
import type { Context } from '../../trpc/context.ts';

export type ConfirmGuardianConsentResult =
  | { outcome: 'confirmed'; clientName: string }
  | { outcome: 'already_confirmed' }
  | { outcome: 'invalid' };

/**
 * Consumes the token, then branches on what the account *actually* says —
 * seven days is long enough for an archive, a deletion request, or an 18th
 * birthday, so the token's existence proves authority, never state.
 *
 * `'invalid'` deliberately collapses unknown, expired, and already-used,
 * exactly as `consumeResetToken` does: a holder of a leaked link learns
 * nothing about why it failed. `'already_confirmed'` is the one exception
 * and is safe because it is only reachable *after* a successful consume —
 * never by probing.
 */
export async function confirmGuardianConsent(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  token: string,
): Promise<ConfirmGuardianConsentResult> {
  const userId = await consumeGuardianConsentToken(token);
  if (!userId) {
    return { outcome: 'invalid' };
  }

  const result = await db.transaction(async (tx): Promise<ConfirmGuardianConsentResult> => {
    const [user] = await tx
      .select({
        name: schema.users.name,
        isMinor: schema.users.isMinor,
        guardianConsentAt: schema.users.guardianConsentAt,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user || user.deletedAt !== null) {
      return { outcome: 'invalid' };
    }
    if (user.guardianConsentAt !== null) {
      return { outcome: 'already_confirmed' };
    }
    // Aged out — `../../jobs/age-sweep.ts` cleared `is_minor` on the 18th
    // birthday between the email going out and the parent clicking. The
    // account no longer needs consent, and telling a parent their
    // confirmation "failed" would be wrong.
    if (!user.isMinor) {
      return { outcome: 'already_confirmed' };
    }

    const [profile] = await tx
      .select({
        id: schema.clientProfiles.id,
        status: schema.clientProfiles.status,
        deletedAt: schema.clientProfiles.deletedAt,
      })
      .from(schema.clientProfiles)
      .where(eq(schema.clientProfiles.userId, userId))
      .limit(1);

    if (!profile || profile.deletedAt !== null || profile.status === 'archived') {
      return { outcome: 'invalid' };
    }

    const now = new Date();

    // Guarded on the current state, not just on the read above — a second
    // outstanding token (task `04`'s resend) could otherwise double-apply.
    // Zero rows here means another request won the race.
    const consented = await tx
      .update(schema.users)
      .set({ guardianConsentAt: now })
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.guardianConsentAt),
          isNull(schema.users.deletedAt),
        ),
      )
      .returning({ id: schema.users.id });
    if (consented.length === 0) {
      return { outcome: 'already_confirmed' };
    }

    // `status` and `activated_at` in the SAME update, with the same `now`.
    // The `client_status_timestamps` CHECK rejects `'active'` with a null
    // `activated_at` at the database level, and a raw constraint error here
    // reaches the guardian as an opaque failure.
    await tx
      .update(schema.clientProfiles)
      .set({ status: 'active', activatedAt: now })
      .where(
        and(eq(schema.clientProfiles.id, profile.id), eq(schema.clientProfiles.status, 'invited')),
      );

    // Actor is the minor's own user id. There is no guardian `users` row to
    // attribute this to — confirming does not create a guardian account
    // (`02`'s Scope) — and `writeAuditLog` requires an actor. Written down
    // because an audit row that silently attributes a parent's action to
    // the child is misleading unless the reason is on the record.
    //
    // The metadata records the *fact* of how consent arrived, never the
    // guardian's email address (`security-and-privacy` skill §5).
    await writeAuditLog(tx, ctx, {
      action: 'guardian_consent.granted',
      targetType: 'user',
      targetId: userId,
      actorUserId: userId,
      metadata: { via: 'emailed consent link' },
    });

    return { outcome: 'confirmed', clientName: user.name };
  });

  if (result.outcome !== 'invalid') {
    await retainConsentLink(token, userId);
  }
  return result;
}

/**
 * Puts the token → user id mapping back after a terminal, non-error
 * outcome. `consumeGuardianConsentToken` is a `GETDEL`, and that is what
 * makes the *grant* single-use and race-safe — but a parent forwarding the
 * email to the other parent, or tapping the link twice, is the ordinary
 * case, not an attack. Without this, the second visit would render `05`'s
 * "this link is invalid" page for an account that is in fact confirmed
 * (`02`'s Risks: "Making the replay case an error", and its acceptance
 * criterion that a second visit returns `'already_confirmed'`).
 *
 * What goes back is not a credential any more: the two `UPDATE`s above are
 * guarded on `guardian_consent_at IS NULL` and `status = 'invited'`, so a
 * retained token can only ever produce `'already_confirmed'` and never a
 * second write. It discloses nothing to a holder who, by definition,
 * already held the link.
 *
 * Failure is swallowed, deliberately: the consent has already committed,
 * and a Redis outage must not turn a successful confirmation into an error
 * page. The cost is that the replay then shows `'invalid'` instead —
 * `04`'s resend is the recovery, exactly as it is for an evicted token.
 */
async function retainConsentLink(token: string, userId: string): Promise<void> {
  try {
    await storeGuardianConsentToken(hashGuardianConsentToken(token), userId);
  } catch {
    logger.warn('guardian_consent.retain_failed', { userId });
  }
}
