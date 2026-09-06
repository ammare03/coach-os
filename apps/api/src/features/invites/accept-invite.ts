// `invites.accept` (`04`) — the only place a client account is ever created
// (`CLAUDE.md` §8.1: clients cannot self-register). Validates the code's
// state exhaustively, re-checks the seat limit independently of `01`'s
// creation-time check (`CLAUDE.md` §15.5), evaluates age exactly as
// `../auth/age.ts`'s own doc comment says this task must (calling
// `isMinorAge`/`computeAgeYears` directly rather than `evaluateSignupAge`,
// which is coach-shaped), and creates the account and invite update in one
// transaction.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { unwrapDatabaseError } from '../../db/is-database-error.ts';
import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import {
  issueGuardianConsentToken,
  storeGuardianConsentToken,
} from '../../lib/auth/guardian-consent-token.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { logger } from '../../lib/logger.ts';
import type { Context } from '../../trpc/context.ts';
import { computeAgeYears, isMinorAge, MINIMUM_AGE_YEARS } from '../auth/age.ts';
import { openSession, type OpenedSession } from '../auth/open-session.ts';
import type { SocialSignInDevice } from '../auth/social-sign-in.ts';

import { createClientAccount } from './create-client-account.ts';
import { assertSeatAvailable } from './seat-check.ts';
import { sendClientIsMinorEmail } from './send-client-is-minor-email.ts';
import { sendGuardianConsentEmail } from './send-guardian-consent-email.ts';

const CLIENT_ONE_ACTIVE_COACH_CONSTRAINT = 'client_profiles_one_active_coach';

export interface AcceptInviteInput {
  code: string;
  password: string;
  name: string;
  timezone: string;
  dateOfBirth: string;
  guardianEmail?: string | undefined;
  device: SocialSignInDevice;
}

// Exported for `account-lifecycle/07`'s `accept-invite-as-existing-client.ts`
// — same code, same terminal states, a different acceptance path once
// validated. One implementation of "what does this code mean right now."
export function inviteNotFound() {
  return appError('INVITE_NOT_FOUND', 'This invite code is not valid.', {});
}

/**
 * Looks up by `code` alone (not scoped to a coach — the code itself is the
 * whole identifier a caller has), then checks every terminal state in the
 * order `04`'s Approach step 1 lists: not found, expired, already accepted,
 * revoked, each with its own catalogued code so the mobile client can show
 * a message that actually matches what happened.
 */
export async function loadAndValidateInvite(db: DbClient, code: string) {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code))
    .limit(1);
  if (!invite) {
    throw inviteNotFound();
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw appError('INVITE_EXPIRED', 'This invite has expired. Ask your coach for a new one.', {
      expiredAt: invite.expiresAt.toISOString(),
    });
  }
  if (invite.acceptedAt) {
    throw appError('INVITE_ALREADY_ACCEPTED', 'This invite has already been used.', {});
  }
  if (invite.revokedAt) {
    throw appError(
      'INVITE_REVOKED',
      'This invite was cancelled. Ask your coach for a new one.',
      {},
    );
  }
  return invite;
}

interface GuardianConsentRequest {
  userId: string;
  guardianEmail: string;
  clientName: string;
  coachName: string;
}

/**
 * Mint, store, audit, send — in that order, and the order is the point
 * (`guardian-consent/01`'s Risks). An emailed link whose token was never
 * persisted is worse than no email: the guardian clicks, is told it is
 * invalid, and has no idea what to do next. `storeGuardianConsentToken`
 * therefore has no `safeRedis` fallback, and a Redis failure rejects here,
 * before anything is sent, for the caller's `.catch()` to absorb.
 *
 * The audit row opens its own small transaction — the same off-response-path
 * shape `../auth/password-reset.ts`'s `sendResetEmail` uses, and for the
 * same reason: the acceptance it follows has already committed.
 */
async function requestGuardianConsent(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  request: GuardianConsentRequest,
): Promise<void> {
  const { token, tokenHash } = issueGuardianConsentToken();
  await storeGuardianConsentToken(tokenHash, request.userId);

  await db.transaction((tx) =>
    writeAuditLog(tx, ctx, {
      action: 'guardian_consent.requested',
      targetType: 'user',
      targetId: request.userId,
      actorUserId: request.userId,
    }),
  );

  await sendGuardianConsentEmail({
    guardianEmail: request.guardianEmail,
    clientName: request.clientName,
    coachName: request.coachName,
    token,
  });
}

export async function acceptInvite(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  input: AcceptInviteInput,
): Promise<OpenedSession> {
  const invite = await loadAndValidateInvite(db, input.code);

  const age = computeAgeYears(input.dateOfBirth);
  if (age < MINIMUM_AGE_YEARS) {
    throw appError('AGE_BELOW_MINIMUM', 'You need to be at least 13 to use CoachOS.', {});
  }
  const isMinor = isMinorAge(input.dateOfBirth);
  if (isMinor && !input.guardianEmail) {
    // `04`'s guardian-consent branch, the first of the two ER§1.2 moments
    // (`packages/schemas/src/errors.ts`'s own comment on the pair): no
    // guardian email has even been collected yet, so there is nothing to
    // notify — the client re-submits with `guardianEmail` filled in.
    throw appError(
      'GUARDIAN_CONSENT_REQUIRED',
      "We need a parent or guardian's email before you can get started.",
      {},
    );
  }

  // Re-checked independently of `invites/01`'s creation-time check
  // (`CLAUDE.md` §15.5) — the coach's tier could have changed, or another
  // invite could have been accepted, in the time since this invite was sent.
  await assertSeatAvailable(db, invite.coachId);

  const passwordHash = await hashPassword(input.password);

  let created;
  try {
    created = await db.transaction(async (tx) => {
      const result = await createClientAccount(tx, ctx, {
        email: invite.email,
        passwordHash,
        name: input.name,
        timezone: input.timezone,
        dateOfBirth: input.dateOfBirth,
        guardianEmail: isMinor ? (input.guardianEmail ?? null) : null,
        coachId: invite.coachId,
      });

      await tx
        .update(schema.invites)
        .set({ acceptedAt: new Date(), acceptedByUserId: result.user.id })
        .where(eq(schema.invites.id, invite.id));

      await writeAuditLog(tx, ctx, {
        action: 'invite.accepted',
        targetType: 'invite',
        targetId: invite.id,
        actorUserId: result.user.id,
      });

      return result;
    });
  } catch (error) {
    const dbError = unwrapDatabaseError(error);
    // `04`'s Approach step 4: the astronomically unlikely case a user has,
    // through some other path, already been bound to a coach — caught here
    // and surfaced as a clear code, never a raw constraint error. Every
    // acceptance mints a brand-new `users` row (§8.1 — there is no separate
    // client sign-up for two invites to race against), so this specific
    // constraint has no live trigger path through `invites.accept` alone
    // today; kept as the same defensive, spec-required translation anyway,
    // since a future path that inserts into `client_profiles` independently
    // (e.g. a P25 team-reassignment flow) must still never leak a raw
    // constraint name to a client.
    if (
      dbError?.code === '23505' &&
      dbError.constraint_name === CLIENT_ONE_ACTIVE_COACH_CONSTRAINT
    ) {
      throw appError('CLIENT_ALREADY_HAS_COACH', 'This account is already bound to a coach.', {});
    }
    throw error;
  }

  const guardianEmail = created.user.guardianEmail;
  if (created.isMinor && guardianEmail) {
    // The same two-step lookup `./create-invite.ts` makes, including its
    // `'Your coach'` fallback — resolved outside the transaction, before
    // either send.
    const [coach] = await db
      .select({ userId: schema.coachProfiles.userId })
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.id, invite.coachId))
      .limit(1);
    const [coachUser] = coach
      ? await db
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, coach.userId))
          .limit(1)
      : [];

    // Both fired after the transaction commits, never inside it, and never
    // awaited on the response path (`./create-invite.ts`'s pattern): a
    // Resend or Redis failure must not fail or roll back an acceptance that
    // already happened. `sendEmail` never throws
    // (`../../lib/email/client.ts`), so these `.catch()`es exist for the
    // Redis write above and to silence an unhandled rejection.
    void requestGuardianConsent(db, ctx, {
      userId: created.user.id,
      guardianEmail,
      clientName: created.user.name,
      coachName: coachUser?.name ?? 'Your coach',
    }).catch(() => {
      // The one failure in here that logs nothing of its own is the token
      // store, and it leaves a minor held pending with no other signal —
      // what reaches support is "the link doesn't work", indistinguishable
      // from a typo. The id only, never the address.
      logger.error('guardian_consent.request_failed', { userId: created.user.id });
    });

    if (coachUser?.email) {
      void sendClientIsMinorEmail({
        coachEmail: coachUser.email,
        clientName: created.user.name,
      }).catch(() => {});
    }
  }

  return openSession(db, ctx, {
    userId: created.user.id,
    role: 'client',
    name: created.user.name,
    timezone: created.user.timezone,
    locale: created.user.locale,
    onboardingCompletedAt: created.user.onboardingCompletedAt,
    coachProfileId: null,
    clientProfileId: created.clientProfile.id,
    device: input.device,
    // `createClientAccount` already wrote `'auth.signup'` atomically with
    // the account itself, and this function wrote `'invite.accepted'` in
    // the same transaction — a third row here would be redundant, same
    // reasoning as `auth.signUp`'s own `auditAction: null`.
    auditAction: null,
  });
}
