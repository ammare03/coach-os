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
 * Writes `guardianconsent:{tokenHash} → userId` **and** the reverse
 * `guardianconsent:user:{userId} → tokenHash` pointer, TTLs fixed by their
 * builders (DB§15: 7 days each). No `safeRedis` fallback, deliberately —
 * Redis *is* the store, so a swallowed write failure would mean emailing a
 * guardian a link that can never work. The caller lets this reject and
 * sends nothing.
 *
 * The pointer is `guardian-consent/04`'s: correcting a mistyped guardian
 * address has to kill the link the wrong recipient already holds, and the
 * only way to find that token from a user id is to have written it down.
 * One `MULTI`, so the two entries can never disagree about which token is
 * outstanding.
 */
export async function storeGuardianConsentToken(tokenHash: string, userId: string): Promise<void> {
  const token = keys.guardianConsent(tokenHash);
  const outstanding = keys.guardianConsentOutstanding(userId);

  const results = await redis
    .multi()
    .set(token.key, userId, 'EX', token.ttlSeconds)
    .set(outstanding.key, tokenHash, 'EX', outstanding.ttlSeconds)
    .exec();

  // `exec()` resolves with `null` on an aborted transaction and reports a
  // per-command failure inside the tuple rather than rejecting — both would
  // otherwise pass for success and send an unusable link.
  if (results === null) {
    throw new Error('guardian consent token store was aborted');
  }
  for (const [error] of results) {
    if (error) throw error;
  }
}

/**
 * Deletes whichever guardian-consent token is currently outstanding for
 * `userId`, and the pointer to it (`guardian-consent/04` Approach step 6).
 * Called before re-minting when the guardian address changes: without it,
 * whoever received the mistyped email keeps a working activation link for
 * up to seven days.
 *
 * A no-op when nothing is outstanding — an evicted or already-consumed
 * token needs no revoking, and that case is the ordinary one on the
 * recovery path this exists to serve.
 */
export async function revokeOutstandingGuardianConsentToken(userId: string): Promise<void> {
  const tokenHash = await redis.getdel(keys.guardianConsentOutstanding(userId).key);
  if (tokenHash !== null) {
    await redis.del(keys.guardianConsent(tokenHash).key);
  }
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
