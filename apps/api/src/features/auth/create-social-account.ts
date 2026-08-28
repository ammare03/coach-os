// The transactional write path for `auth.completeSocialSignUp` — user row,
// coach profile row, the `auth_providers` link, and the audit row, in one
// transaction. Parallels `./create-coach-account.ts`'s shape exactly; kept
// as a separate function rather than a shared one because the two differ in
// every column that matters (no password hash, a pre-verified email, and
// the extra `auth_providers` insert) and forcing one function to branch on
// "is this social" would just move the difference into an `if`.
import { schema, type CoachProfile, type Transaction, type User } from '@coachos/db';

import { writeAuditLog } from '../../lib/audit-log.ts';
import { linkProviderToUser, type SocialProvider } from '../../lib/social-auth-link.ts';
import type { Context } from '../../trpc/context.ts';

export interface CreateSocialCoachAccountInput {
  email: string;
  name: string;
  timezone: string;
  // Age-checked by the caller before this function ever runs — same
  // discipline as `./create-coach-account.ts`'s own `dateOfBirth` field.
  dateOfBirth: string;
  provider: SocialProvider;
  providerUid: string;
}

export interface CreateSocialCoachAccountResult {
  user: User;
  coachProfile: CoachProfile;
}

/**
 * `role` is fixed to `'coach'`, never a parameter — social sign-up mirrors
 * `auth.signUp`'s own restriction (`02`'s "Why this exists": clients don't
 * self-register, social or otherwise). `passwordHash: null` plus
 * `emailVerifiedAt` set is `users_email_or_social`'s other permitted shape —
 * the provider already verified this address, so there is nothing left to
 * confirm.
 *
 * `tx` has no default, same convention as `./create-coach-account.ts` — a
 * caller that forgets `db.transaction(...)` fails to compile rather than
 * silently running three separate commits.
 */
export async function createSocialCoachAccount(
  tx: Transaction,
  ctx: Pick<Context, 'user' | 'request'>,
  input: CreateSocialCoachAccountInput,
): Promise<CreateSocialCoachAccountResult> {
  const [user] = await tx
    .insert(schema.users)
    .values({
      email: input.email,
      passwordHash: null,
      name: input.name,
      role: 'coach',
      timezone: input.timezone,
      dateOfBirth: input.dateOfBirth,
      isMinor: false,
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insert into identity.users did not return a row');

  const [coachProfile] = await tx
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning();
  if (!coachProfile) throw new Error('insert into identity.coach_profiles did not return a row');

  await linkProviderToUser(tx, user.id, {
    provider: input.provider,
    providerUid: input.providerUid,
  });

  await writeAuditLog(tx, ctx, {
    action: 'auth.signup',
    targetType: 'user',
    targetId: user.id,
    actorUserId: user.id,
  });

  return { user, coachProfile };
}
