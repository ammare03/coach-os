// `invites.resendGuardianConsent` (`guardian-consent/04`) — the recovery
// path that makes `../../lib/auth/guardian-consent-token.ts`'s "Redis is
// the only store" acceptable, and the answer to `docs/UNFORGET.md` S7's
// stranding question. Without it a 7-day expiry, a free-tier eviction, a
// spam folder, or a mistyped address each leaves a minor's account held at
// `status: 'invited'` forever, with the invite code already burned so the
// coach cannot re-invite them either.
//
// **The minor triggers this, never the coach.** They are the one holding
// the phone, looking at the pending screen, standing next to the parent
// whose address they mistyped. The coach cannot fix it: they are
// deliberately never told the guardian's address (`auth-server/07` step 5),
// and a coach-side resend would need a pending-consent surface no phase
// before P10 has. If P10 later wants a "nudge", it calls this same function
// on the client's behalf rather than growing a second send path.
//
// **It is built on `protectedProcedure`, not `clientProcedure`** — see
// `../../routers/invites.ts`. That is forced by `guardian-consent/03`: the
// caller is by definition an account `clientProcedure` is rejecting, so a
// resend on that builder is unreachable by exactly the people who need it.
import { createHash } from 'node:crypto';

import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { writeAuditLog } from '../../lib/audit-log.ts';
import {
  issueGuardianConsentToken,
  revokeOutstandingGuardianConsentToken,
  storeGuardianConsentToken,
} from '../../lib/auth/guardian-consent-token.ts';
import { keys } from '../../lib/redis-keys.ts';
import type { Context } from '../../trpc/context.ts';
import { enforceRateLimit } from '../../trpc/middleware/rate-limit.ts';

import { sendGuardianConsentEmail } from './send-guardian-consent-email.ts';

/** 3 per 15 minutes on both axes; the windows live in the key builders. */
const RESEND_MAX = 3;

/**
 * The single response, for every caller and every outcome — sent, no-op,
 * adult, coach, already consented. A procedure that answered differently
 * for a minor would be an oracle for "is this account under 18".
 */
const ACKNOWLEDGED = { success: true } as const;

export type ResendGuardianConsentResult = typeof ACKNOWLEDGED;

export interface ResendGuardianConsentOptions {
  /** A correction. Absent means "send to whatever is on file". Never null — the address cannot be cleared. */
  guardianEmail?: string | undefined;
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

export async function resendGuardianConsent(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  options: ResendGuardianConsentOptions,
): Promise<ResendGuardianConsentResult> {
  // Before the eligibility read, and unconditionally — a limit that only
  // applied to real minors would itself answer the question the uniform
  // return value exists to hide.
  await enforceRateLimit(keys.rateLimitGuardianConsentResend(userId), RESEND_MAX);

  const target = await loadPendingConsent(db, userId);
  if (!target) {
    return ACKNOWLEDGED;
  }

  const destination = options.guardianEmail ?? target.guardianEmail;

  // Second axis, keyed on the destination. Checked after eligibility, so an
  // ineligible caller can neither send nor burn a real guardian's counter —
  // the limit protects that inbox, and letting a stranger exhaust it would
  // be the denial of service it exists to prevent.
  await enforceRateLimit(keys.rateLimitGuardianConsentEmail(hashEmail(destination)), RESEND_MAX);

  if (destination !== target.guardianEmail) {
    const changed = await changeGuardianEmail(db, ctx, userId, target.guardianEmail, destination);
    if (!changed) {
      // Consent landed, or the account went away, between the read above
      // and the write. Nothing to send, and nothing to say about it.
      return ACKNOWLEDGED;
    }
    // Before minting the replacement, never after: whoever received the
    // mistyped email must not keep a link that still activates the account.
    await revokeOutstandingGuardianConsentToken(userId);
  }

  const { token, tokenHash } = issueGuardianConsentToken();
  await storeGuardianConsentToken(tokenHash, userId);

  // `sendEmail` never throws (`../../lib/email/client.ts`), so this is
  // awaited rather than fire-and-forget: the caller is a person waiting on
  // a screen, and there is no acceptance transaction here for a slow Resend
  // call to endanger.
  await sendGuardianConsentEmail({
    guardianEmail: destination,
    clientName: target.clientName,
    coachName: target.coachName,
    token,
  });

  return ACKNOWLEDGED;
}

interface PendingConsent {
  clientName: string;
  guardianEmail: string;
  coachName: string;
}

/**
 * Everything the send needs, and `null` for every account this does not
 * apply to — an adult, a coach, a deleted or archived account, and, most
 * importantly, one whose `guardian_consent_at` is already set.
 *
 * That last case is a hard refusal rather than an update:
 * `services/export/delegated.ts`'s `isConfirmedGuardianOf` matches purely
 * on `guardian_email` against a verified account's own address, so moving
 * the address after consent would silently transfer a guardian's export and
 * deletion rights — a guardian-substitution attack with a nice UI.
 */
async function loadPendingConsent(db: DbClient, userId: string): Promise<PendingConsent | null> {
  const [user] = await db
    .select({
      name: schema.users.name,
      isMinor: schema.users.isMinor,
      guardianEmail: schema.users.guardianEmail,
      guardianConsentAt: schema.users.guardianConsentAt,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (
    !user ||
    user.deletedAt !== null ||
    !user.isMinor ||
    user.guardianConsentAt !== null ||
    user.guardianEmail === null
  ) {
    return null;
  }

  const [profile] = await db
    .select({
      coachId: schema.clientProfiles.coachId,
      status: schema.clientProfiles.status,
      deletedAt: schema.clientProfiles.deletedAt,
    })
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.userId, userId))
    .limit(1);

  if (!profile || profile.deletedAt !== null || profile.status === 'archived') {
    return null;
  }

  // The same two-step lookup and `'Your coach'` fallback
  // `./accept-invite.ts` makes for the first send, so the resent email
  // reads identically to the one it replaces. `coach_id` is nullable — a
  // relationship can end while consent is still pending — and that falls
  // through to the same fallback rather than blocking the recovery: the
  // account still has to become un-stranded.
  const [coach] = profile.coachId
    ? await db
        .select({ userId: schema.coachProfiles.userId })
        .from(schema.coachProfiles)
        .where(eq(schema.coachProfiles.id, profile.coachId))
        .limit(1)
    : [];
  const [coachUser] = coach
    ? await db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, coach.userId))
        .limit(1)
    : [];

  return {
    clientName: user.name,
    guardianEmail: user.guardianEmail,
    coachName: coachUser?.name ?? 'Your coach',
  };
}

/**
 * Re-guarded on `is_minor` and `guardian_consent_at IS NULL` in the `WHERE`,
 * not just on the read above: a guardian confirming in the same second must
 * win, and zero rows updated is how that is detected. The new address is
 * non-null by construction (`resendGuardianConsentInput` admits no null and
 * no empty string), so `users_minor_has_guardian` cannot be violated here.
 *
 * Both addresses are hashed in the audit row. A guardian email is a third
 * party's personal data (§21.1 Personal) belonging to someone who is not a
 * CoachOS user, and it does not belong duplicated across audit history —
 * the hashes prove that an address changed, and match two rows against each
 * other, without storing either one again.
 */
async function changeGuardianEmail(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  previousEmail: string,
  nextEmail: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.users)
      .set({ guardianEmail: nextEmail })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.isMinor, true),
          isNull(schema.users.guardianConsentAt),
          isNull(schema.users.deletedAt),
        ),
      )
      .returning({ id: schema.users.id });

    if (rows.length === 0) {
      return false;
    }

    await writeAuditLog(tx, ctx, {
      action: 'guardian_consent.email_changed',
      targetType: 'user',
      targetId: userId,
      actorUserId: userId,
      metadata: {
        previousEmailHash: hashEmail(previousEmail),
        newEmailHash: hashEmail(nextEmail),
      },
    });

    return true;
  });
}
