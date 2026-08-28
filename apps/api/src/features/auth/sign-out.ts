// The two sign-out procedure bodies (`05`), kept out of the router so
// `routers/auth.ts` stays thin. Both always return success — an unknown,
// malformed, revoked, or expired token is not an error here, only a
// signal that there is nothing left to revoke (`05`'s Produces section:
// "the sign-out contract, stated once for the client").
import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { hashRefreshToken } from '../../lib/auth/refresh-token.ts';
import type { Context } from '../../trpc/context.ts';

import { revokeAllFamiliesForUser, revokeFamily } from './revoke-family.ts';

/**
 * Revokes the family the presented refresh token belongs to, and only that
 * family — never by `user_id` (`05`'s Risks: "the tempting simplification
 * is to revoke by user... it turns every sign-out into a sign-out-
 * everywhere"). The family is resolved from the token's own digest, never
 * from caller input, so no procedure here can be pointed at someone else's
 * session (`05`'s Approach step 2).
 */
export async function signOut(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  presentedToken: string | undefined,
): Promise<void> {
  if (!presentedToken) {
    // A device that already discarded its tokens locally has nothing to
    // present — no family to resolve, no-op (`signOutInput`'s own doc
    // comment).
    return;
  }

  const tokenHash = hashRefreshToken(presentedToken);
  const [row] = await db
    .select({ familyId: schema.refreshTokens.familyId })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash));

  if (!row) {
    // No row, no family, nothing to revoke — the same "return, do not
    // revoke" rule task 04 established for an unknown token, just with a
    // success response instead of a rejection (`05`'s Approach step 7).
    return;
  }

  await revokeFamily(db, ctx, row.familyId, 'signout');
}

/** Revokes every live family for `userId` — `auth.signOutAllDevices`, a `protectedProcedure`, so `userId` comes from `ctx.user`, never from input. */
export async function signOutAllDevices(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
): Promise<void> {
  await revokeAllFamiliesForUser(db, ctx, userId, 'signout_all');
}
