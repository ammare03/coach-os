// Generation, the digest, and the Redis-backed store for a password-reset
// token (`06`). DB§5.1 gains no table for this — a reset token is
// legitimately ephemeral (`06`'s "Why this exists": losing every
// outstanding token to a Redis restart costs one more email, which is the
// correct failure mode for a credential-recovery flow, not a reason to add
// a table with its own DB§19.2 purge entry).
import { createHash, randomBytes } from 'node:crypto';

import { keys } from '../redis-keys.ts';
import { redis } from '../redis.ts';

const TOKEN_BYTES = 32; // 256 bits of CSPRNG output — same shape as a refresh token

/**
 * Unlike the refresh-token digest, this one is a bare SHA-256, not keyed.
 * `REFRESH_TOKEN_SECRET` exists so rotating it kills every session at
 * once; there's no equivalent capability worth having here — a reset
 * token dies on its own within the hour (`06`'s Approach step 2).
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedResetToken {
  token: string;
  tokenHash: string;
}

export function issueResetToken(): IssuedResetToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

/**
 * Writes `pwreset:{tokenHash} → userId`, TTL fixed by `keys.pwreset`
 * (DB§15: 60 minutes). No `safeRedis` fallback here, deliberately — unlike
 * a cache, Redis *is* the store for this value; a write failure means the
 * token genuinely does not exist anywhere, and the caller
 * (`../../features/auth/password-reset.ts`) must not send an email
 * promising a link that will never work.
 */
export async function storeResetToken(tokenHash: string, userId: string): Promise<void> {
  const { key, ttlSeconds } = keys.pwreset(tokenHash);
  await redis.set(key, userId, 'EX', ttlSeconds);
}

/**
 * Atomically reads and deletes the token in one round trip (`GETDEL`) —
 * the single-use guarantee (`06`'s Approach step 3). Returns the `userId`
 * on the token's first, only, valid consumption; `null` for every other
 * case an unknown, expired, or already-used token produces, deliberately
 * collapsed into one outcome so a caller holding a leaked token learns
 * nothing about *why* it failed.
 *
 * Two concurrent submissions of the same token: exactly one `GETDEL`
 * observes the value and deletes it: Redis is single-threaded per key, so
 * there is no window for both callers to read a still-present value.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  const { key } = keys.pwreset(hashResetToken(token));
  const userId = await redis.getdel(key);
  return userId;
}
