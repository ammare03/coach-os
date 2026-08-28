// The shared body of `auth.signInWithApple` / `auth.signInWithGoogle`
// (`social-sign-in/01`, `/02`) — everything after the provider token is
// already verified. Kept out of the router so `routers/auth.ts` stays thin,
// same convention as `./password-reset.ts`.
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import {
  issuePendingSignupToken,
  storePendingSignup,
} from '../../lib/auth/social-signup-pending.ts';
import { resolveSocialIdentity, type SocialIdentityClaim } from '../../lib/social-auth-link.ts';
import type { Context } from '../../trpc/context.ts';

import { openSession, type OpenedSession } from './open-session.ts';

export interface SocialSignInDevice {
  deviceId?: string | undefined;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string | undefined;
  osVersion?: string | undefined;
}

/**
 * Discriminated on `kind` rather than reusing `OpenedSession` alone — a
 * brand-new identity never opens a session here at all (`social-sign-in/03`'s
 * DOB gate, `../../lib/auth/social-signup-pending.ts`'s own doc comment for
 * why), so the client needs a shape it can branch on before any token
 * exists.
 */
export type SocialSignInResult =
  | ({ kind: 'session' } & OpenedSession)
  | { kind: 'needsDateOfBirth'; pendingSignupToken: string; email: string };

function socialAccountExists(provider: SocialIdentityClaim['provider']) {
  return appError(
    'SOCIAL_ACCOUNT_EXISTS',
    'An account with this email already exists. Sign in to link it instead.',
    { provider },
  );
}

function accountUnavailable() {
  // The `auth_providers` row's user was soft-deleted after linking — rare
  // (nothing in this feature deletes a user), but a stale link must not
  // silently open a session for a gone account.
  return appError('AUTH_REQUIRED', 'This account is no longer available.', {});
}

export async function handleSocialSignIn(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  claim: SocialIdentityClaim,
  device: SocialSignInDevice,
  // The best name available for this identity outside `claim` itself —
  // Google's verified `name` claim (`routers/auth.ts` reads it off the
  // full `ProviderClaim` before narrowing to `SocialIdentityClaim`), or
  // Apple's client-supplied one-time `fullName`. `null` when neither
  // provider gave one. Not part of `SocialIdentityClaim` — resolving a
  // provider identity to a `userId` never needs it; only account
  // *creation* does.
  name: string | null = null,
): Promise<SocialSignInResult> {
  const resolution = await resolveSocialIdentity(db, claim);

  if (resolution.outcome === 'collision') {
    throw socialAccountExists(claim.provider);
  }

  if (resolution.outcome === 'newIdentity') {
    if (!claim.email) {
      throw appError('VALIDATION_FAILED', 'That data could not be saved as sent.', {
        fields: { email: 'This sign-in method did not provide an email address.' },
      });
    }
    const { token, tokenHash } = issuePendingSignupToken();
    await storePendingSignup(tokenHash, {
      provider: claim.provider,
      providerUid: claim.providerUid,
      email: claim.email,
      name,
    });
    return { kind: 'needsDateOfBirth', pendingSignupToken: token, email: claim.email };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, resolution.userId))
    .limit(1);
  if (!user || user.deletedAt) {
    throw accountUnavailable();
  }

  const [coachProfile] =
    user.role === 'coach'
      ? await db
          .select({ id: schema.coachProfiles.id })
          .from(schema.coachProfiles)
          .where(eq(schema.coachProfiles.userId, user.id))
          .limit(1)
      : [];
  const [clientProfile] =
    user.role === 'client'
      ? await db
          .select({ id: schema.clientProfiles.id })
          .from(schema.clientProfiles)
          .where(eq(schema.clientProfiles.userId, user.id))
          .limit(1)
      : [];

  const opened = await openSession(db, ctx, {
    userId: user.id,
    role: user.role,
    name: user.name,
    timezone: user.timezone,
    locale: user.locale,
    onboardingCompletedAt: user.onboardingCompletedAt,
    coachProfileId: coachProfile?.id ?? null,
    clientProfileId: clientProfile?.id ?? null,
    device,
    auditAction: 'auth.signin',
  });
  return { kind: 'session', ...opened };
}
