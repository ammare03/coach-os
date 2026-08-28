// `social-sign-in/03` — the shared logic both `signInWithApple` and
// `signInWithGoogle` (`../../routers/auth.ts`) call once they hold a
// verified `(provider, providerUid, email)` claim. Three outcomes only:
// an existing linked user, a genuine new identity, or an email collision
// that must never auto-merge (`03`'s Approach, steps 1-3). Token issuance
// is deliberately out of scope here — the caller reuses `openSession`
// once a `userId` is resolved.
import { schema, type DbClient, type Transaction } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { unwrapDatabaseError } from '../db/is-database-error.ts';

export type SocialProvider = 'apple' | 'google';

export interface SocialIdentityClaim {
  provider: SocialProvider;
  providerUid: string;
  email: string | null;
}

export type ResolveSocialIdentityResult =
  | { outcome: 'existingUser'; userId: string }
  | { outcome: 'collision' }
  | { outcome: 'newIdentity' };

/**
 * Step 1: look up `(provider, providerUid)` directly — a returning user via
 * this exact provider, no ambiguity, resolved without ever touching `email`.
 * Step 2/3: no link yet, so `email` decides new-identity vs. collision. A
 * `null` email (a provider that withheld it) can never match an existing
 * `users` row by definition, so it always resolves `newIdentity` — there is
 * nothing to collide with.
 */
export async function resolveSocialIdentity(
  db: DbClient,
  claim: SocialIdentityClaim,
): Promise<ResolveSocialIdentityResult> {
  const [existingLink] = await db
    .select({ userId: schema.authProviders.userId })
    .from(schema.authProviders)
    .where(
      and(
        eq(schema.authProviders.provider, claim.provider),
        eq(schema.authProviders.providerUid, claim.providerUid),
      ),
    )
    .limit(1);

  if (existingLink) {
    return { outcome: 'existingUser', userId: existingLink.userId };
  }

  if (!claim.email) {
    return { outcome: 'newIdentity' };
  }

  const [existingUser] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.email, claim.email), isNull(schema.users.deletedAt)))
    .limit(1);

  return existingUser ? { outcome: 'collision' } : { outcome: 'newIdentity' };
}

const PROVIDER_UID_CONSTRAINT = 'auth_providers_provider_uid_unique';

/**
 * Inserts the `auth_providers` row that finalises a link — called both from
 * the collision-resolution flow (after the caller has proven ownership of
 * the existing account by signing in with it) and from new-account creation.
 * `03`'s Approach step 4: a concurrent second link attempt racing this one
 * hits the same unique constraint; since both attempts wanted the identical
 * end state (this provider identity linked to this user), that race
 * resolves as success rather than a surfaced error — but only when the
 * constraint violation is genuinely this pair; any other database error
 * still propagates.
 *
 * The insert runs inside a nested `tx.transaction()` (a `SAVEPOINT`) rather
 * than a bare try/catch around `tx.insert()` directly — Postgres aborts the
 * *entire* enclosing transaction on any statement error, so catching the JS
 * exception alone still leaves the caller's transaction unable to commit.
 * The savepoint is what makes "catch this one violation and keep going in
 * the same transaction" actually true rather than merely compile.
 */
export async function linkProviderToUser(
  tx: Transaction,
  userId: string,
  claim: Pick<SocialIdentityClaim, 'provider' | 'providerUid'>,
): Promise<void> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.insert(schema.authProviders).values({
        userId,
        provider: claim.provider,
        providerUid: claim.providerUid,
      });
    });
  } catch (error) {
    const dbError = unwrapDatabaseError(error);
    if (dbError?.code === '23505' && dbError.constraint_name === PROVIDER_UID_CONSTRAINT) {
      return;
    }
    throw error;
  }
}
