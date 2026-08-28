// `auth.completeSocialSignUp` (`social-sign-in/03` + Ammar's DOB-gate
// decision — see `../../lib/auth/social-signup-pending.ts`'s doc comment).
// The second half of a brand-new social sign-up: consume the pending
// claim, run the same age rule `auth-server/07` applies to a password
// signup, then create the account.
import type { DbClient } from '@coachos/db';

import { appError } from '../../lib/app-error.ts';
import { consumePendingSignup } from '../../lib/auth/social-signup-pending.ts';
import type { Context } from '../../trpc/context.ts';

import { evaluateSignupAge } from './age.ts';
import { createSocialCoachAccount } from './create-social-account.ts';
import { openSession, type OpenedSession } from './open-session.ts';
import type { SocialSignInDevice } from './social-sign-in.ts';

export interface CompleteSocialSignUpInput {
  pendingSignupToken: string;
  timezone: string;
  dateOfBirth: string;
  device: SocialSignInDevice;
}

function expiredPendingSignup() {
  return appError('AUTH_REQUIRED', 'This sign-in attempt has expired. Try again.', {});
}

/**
 * The last-resort name when neither provider gave one (Apple, on any
 * authorization after the very first — Google practically always
 * includes a `name` claim). `users.name` is `NOT NULL` and this screen
 * has no field to ask with (the approved `/design` canvas), so this is
 * what stands in until the coach edits their profile. Splits the email's
 * local part on the common separators and title-cases each piece —
 * `jane.doe@x.com` → "Jane Doe"; a local part with no separator just gets
 * its first letter capitalised.
 */
function deriveNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  const words = localPart.split(/[._+-]+/).filter((w) => w.length > 0);
  const titled = (words.length > 0 ? words : [localPart]).map(
    (w) => w.charAt(0).toUpperCase() + w.slice(1),
  );
  return titled.join(' ').slice(0, 200);
}

export async function completeSocialSignUp(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  input: CompleteSocialSignUpInput,
): Promise<OpenedSession> {
  // Age-checked BEFORE consuming the token, deliberately — `dateOfBirth`
  // is the caller's input alone, nothing to do with the pending record,
  // and `consumePendingSignup` is single-use (`GETDEL`). Checking after
  // would burn the token on a rejected age and force the person back
  // through the entire Apple/Google sheet just to retype a birthdate.
  const ageOutcome = evaluateSignupAge(input.dateOfBirth);
  if (ageOutcome === 'AGE_BELOW_MINIMUM') {
    throw appError('AGE_BELOW_MINIMUM', 'You need to be at least 13 to use CoachOS.', {});
  }
  if (ageOutcome === 'COACH_MUST_BE_ADULT') {
    throw appError(
      'COACH_MUST_BE_ADULT',
      'Coach accounts are for adults only. You can still join as a client if a coach invites you.',
      {},
    );
  }

  const pending = await consumePendingSignup(input.pendingSignupToken);
  if (!pending) {
    throw expiredPendingSignup();
  }

  // A duplicate email here surfaces as a raw `users_email_unique` violation,
  // left uncaught for the same reason `auth.signUp` leaves it uncaught
  // (`../../routers/auth.ts`'s own comment) — the request-wide
  // `databaseErrorBoundary` turns it into `UNKNOWN_CONFLICT`.
  const { user, coachProfile } = await db.transaction((tx) =>
    createSocialCoachAccount(tx, ctx, {
      email: pending.email,
      name: pending.name ?? deriveNameFromEmail(pending.email),
      timezone: input.timezone,
      dateOfBirth: input.dateOfBirth,
      provider: pending.provider,
      providerUid: pending.providerUid,
    }),
  );

  return openSession(db, ctx, {
    userId: user.id,
    role: user.role,
    name: user.name,
    timezone: user.timezone,
    locale: user.locale,
    onboardingCompletedAt: user.onboardingCompletedAt,
    coachProfileId: coachProfile.id,
    clientProfileId: null,
    device: input.device,
    // `createSocialCoachAccount` already wrote `'auth.signup'` atomically
    // with the account itself — same reasoning as `auth.signUp`'s own call.
    auditAction: null,
  });
}
