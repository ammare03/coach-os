// The rotation transaction, the reuse branch, and the race branch (`04`) —
// cannot be split further (`04`'s "Why this is an L"). One atomic
// conditional UPDATE decides the winner of any concurrent race; a second
// UPDATE returning zero rows is diagnosed, never assumed to mean theft.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { appError } from '../../lib/app-error.ts';
import { issueAccessToken } from '../../lib/auth/access-token.ts';
import { hashRefreshToken, issueRefreshToken } from '../../lib/auth/refresh-token.ts';
import { keys } from '../../lib/redis-keys.ts';
import type { Context } from '../../trpc/context.ts';
import { RATE_LIMIT_TIERS } from '../../trpc/middleware/rate-limit-config.ts';
import { enforceRateLimit } from '../../trpc/middleware/rate-limit.ts';

import { revokeFamily } from './revoke-family.ts';

// A benign race — two requests discovering an expired access token at once,
// both refreshing the same stored token — must land here, not in the reuse
// branch. Long enough to cover an app foreground firing several requests
// and a slow network round trip; short enough that a thief replaying a
// stolen token minutes or hours later lands squarely in reuse instead
// (`04`'s Approach step 3).
const REUSE_GRACE_WINDOW_MS = 10 * 1000;

export interface RotateRefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Exchanges a presented refresh token for a new access/refresh pair,
 * rotating the family. Throws `UNAUTHORIZED` for an unknown, malformed,
 * revoked-past-grace, or expired token (revoking nothing); throws
 * `REFRESH_RACE` for a benign concurrent replay (family untouched); throws
 * `REFRESH_TOKEN_REUSED` after revoking the whole family on genuine reuse.
 */
export async function rotateRefreshToken(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  presentedToken: string,
): Promise<RotateRefreshTokenResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  const successor = issueRefreshToken();

  // Rate-limit per family (`04`'s Approach step 5), not per IP — the
  // family is only knowable after a lookup, which is why this can't be a
  // tRPC middleware (`rate-limit.ts`'s `enforceRateLimit` doc comment). A
  // token this doesn't recognise falls straight through to the transaction
  // below, which diagnoses "unknown token" the same way it always did —
  // there's no family yet to rate-limit against.
  const [preLookup] = await db
    .select({ familyId: schema.refreshTokens.familyId })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash));
  if (preLookup) {
    const tier = RATE_LIMIT_TIERS.authRefresh;
    await enforceRateLimit(
      keys.rateLimit('auth.refresh', preLookup.familyId, tier.windowSeconds),
      tier.max,
    );
  }

  const rotated = await db.transaction(async (tx) => {
    // The one conditional UPDATE that is the whole concurrency design
    // (`04`'s Approach step 2) — the database is the lock. Only the caller
    // whose UPDATE actually flips `revoked_at` may proceed to insert a
    // successor; every other concurrent caller gets zero rows back.
    const [consumed] = await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.tokenHash, tokenHash),
          isNull(schema.refreshTokens.revokedAt),
          gt(schema.refreshTokens.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!consumed) {
      return null;
    }

    const [inserted] = await tx
      .insert(schema.refreshTokens)
      .values({
        userId: consumed.userId,
        tokenHash: successor.tokenHash,
        familyId: consumed.familyId,
        deviceId: consumed.deviceId,
        expiresAt: successor.expiresAt,
      })
      .returning({ id: schema.refreshTokens.id });
    if (!inserted) throw new Error('insert into identity.refresh_tokens did not return a row');

    await tx
      .update(schema.refreshTokens)
      .set({ replacedBy: inserted.id })
      .where(eq(schema.refreshTokens.id, consumed.id));

    return { userId: consumed.userId, role: 'coach' as const, deviceId: consumed.deviceId };
  });

  if (rotated) {
    // `refresh_tokens.device_id` is nullable (`ON DELETE SET NULL` — a
    // device row can be removed without invalidating an otherwise-valid
    // session, DB§5.1's own comment on the column). A refresh from a
    // family whose device row is gone is a real but rare edge case outside
    // this task's scope; the empty string keeps the claim set's shape
    // intact rather than widening `did` to `string | null` everywhere that
    // reads it.
    const accessToken = await issueAccessToken({
      userId: rotated.userId,
      role: await resolveRole(db, rotated.userId),
      deviceId: rotated.deviceId ?? '',
    });
    return {
      accessToken: accessToken.token,
      refreshToken: successor.token,
      expiresAt: accessToken.expiresAt,
    };
  }

  // The UPDATE returned zero rows — diagnose why before reacting (`04`'s
  // Approach step 3's diagram). A second `issueRefreshToken()` call above
  // was wasted work in every branch from here on; that's the accepted cost
  // of computing it outside the transaction, where `hash`/CSPRNG calls
  // belong.
  const [existing] = await db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, tokenHash));

  if (!existing) {
    // No row at all — a garbage or forged token. Revoking on it would let
    // anyone log anyone else out; there is nothing to revoke.
    throw unauthorized();
  }

  if (!existing.revokedAt) {
    // A row exists, isn't revoked, but the UPDATE still matched zero rows —
    // only possible if `expires_at` had already passed the `gt()` check.
    // The family is otherwise healthy; the user signs in again.
    throw unauthorized();
  }

  const withinGrace = Date.now() - existing.revokedAt.getTime() <= REUSE_GRACE_WINDOW_MS;
  if (withinGrace && existing.replacedBy) {
    const [successorRow] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.id, existing.replacedBy));
    if (successorRow && !successorRow.revokedAt) {
      // A benign race: the successor this token was already replaced by is
      // still live. Family untouched — the other concurrent caller already
      // won and returned the real pair.
      throw appError('REFRESH_RACE', 'Another refresh is already in progress. Try again.', {});
    }
  }

  // Reuse: revoke every live token in the family and record why.
  await revokeFamily(db, ctx, existing.familyId, {
    auditAction: 'auth.refresh.reuse',
    metadata: {
      deviceId: existing.deviceId,
      revokedTokenId: existing.id,
      openedFamilyAt: existing.createdAt,
    },
  });
  throw appError('REFRESH_TOKEN_REUSED', 'This session is no longer valid. Sign in again.', {});
}

function unauthorized() {
  return appError('AUTH_REQUIRED', 'This session is no longer valid. Sign in again.', {});
}

async function resolveRole(
  db: DbClient,
  userId: string,
): Promise<'coach' | 'client' | 'assistant'> {
  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user?.role ?? 'coach';
}
