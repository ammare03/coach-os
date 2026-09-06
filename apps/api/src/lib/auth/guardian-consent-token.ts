// Generation, the digest, and the Redis-backed store for a guardian-consent
// token (`guardian-consent/01`). Deliberately a near-copy of
// `./reset-token.ts` rather than a shared, parameterised module: the TTLs
// differ by two orders of magnitude and the failure semantics differ (see
// below), so one abstraction would have to be re-reasoned by whoever
// changes either.
//
// ⚠️ Redis is the only store, and it is not durable. For a password reset
// that costs one more email; here an eviction strands a minor's account,
// because nothing in `identity` records that a consent request is
// outstanding. That is acceptable **only because
// `guardian-consent/04-resend-and-correction.md` exists** — the resend path
// is what makes losing a token recoverable. Do not read this file as
// "Redis durability is fine on its own."
import { createHash, randomBytes } from 'node:crypto';

import { keys } from '../redis-keys.ts';
import { redis } from '../redis.ts';

const TOKEN_BYTES = 32; // 256 bits of CSPRNG output — same shape as a reset token

/**
 * A bare SHA-256, not keyed, for the same reason `hashResetToken` is: the
 * capability a `REFRESH_TOKEN_SECRET` rotation buys (killing every
 * outstanding token at once) has no use here.
 */
export function hashGuardianConsentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedGuardianConsentToken {
  token: string;
  tokenHash: string;
}

export function issueGuardianConsentToken(): IssuedGuardianConsentToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashGuardianConsentToken(token) };
}

/**
 * Writes `guardianconsent:{tokenHash} → userId`, TTL fixed by
 * `keys.guardianConsent` (DB§15: 7 days). No `safeRedis` fallback,
 * deliberately — Redis *is* the store, so a swallowed write failure would
 * mean emailing a guardian a link that can never work. The caller lets this
 * reject and sends nothing.
 */
export async function storeGuardianConsentToken(tokenHash: string, userId: string): Promise<void> {
  const { key, ttlSeconds } = keys.guardianConsent(tokenHash);
  await redis.set(key, userId, 'EX', ttlSeconds);
}

/**
 * Atomically reads and deletes in one round trip (`GETDEL`) — the
 * single-use guarantee. Resolves the minor's `users.id` on the token's
 * first and only valid consumption; `null` for an unknown, an expired, and
 * an already-used token alike, collapsed into one outcome so a holder of a
 * leaked token learns nothing about *why* it failed.
 *
 * Redis is single-threaded per key, so two concurrent confirmations of the
 * same link cannot both observe the value: exactly one gets the id.
 */
export async function consumeGuardianConsentToken(token: string): Promise<string | null> {
  const { key } = keys.guardianConsent(hashGuardianConsentToken(token));
  return redis.getdel(key);
}
