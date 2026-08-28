// A brand-new social identity (`../social-auth-link.ts`'s `newIdentity`
// outcome) cannot become a `users` row yet — `auth-server/07` requires
// `date_of_birth` at signup for both roles, and neither Apple nor Google
// hands one over. Rather than create the account and backfill the age
// check (exactly the shortcut `07`'s Risks section forbids for the
// password path), the verified claim is held here, ephemerally, until the
// client collects a birthdate and calls `auth.completeSocialSignUp`.
//
// Same shape as `./reset-token.ts`'s password-reset token: Redis is the
// store, not a cache — a write failure means the token genuinely does not
// exist anywhere, and a restart losing an outstanding one just costs a
// repeated sign-in tap, the correct failure mode for something this
// short-lived (`DATABASE.md` DB§15's `socialsignup:{tokenHash}` entry).
import { createHash, randomBytes } from 'node:crypto';

import { keys } from '../redis-keys.ts';
import { redis } from '../redis.ts';
import type { SocialProvider } from '../social-auth-link.ts';

const TOKEN_BYTES = 32; // 256 bits of CSPRNG output — same shape as a refresh/reset token

export interface PendingSocialSignup {
  provider: SocialProvider;
  providerUid: string;
  email: string;
  // Google's own `name` claim, or Apple's one-time `fullName` from the
  // client — `null` when the provider gave nothing (Apple, on any
  // authorization after the first). `complete-social-signup.ts` falls
  // back to deriving something from `email` when this is `null`; the
  // date-of-birth screen has no name field to ask with instead.
  name: string | null;
}

/** Bare SHA-256, same reasoning as `./reset-token.ts`'s `hashResetToken` — this token dies on its own within its TTL, so there's no rotating secret worth keying it with. */
export function hashPendingSignupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedPendingSignupToken {
  token: string;
  tokenHash: string;
}

export function issuePendingSignupToken(): IssuedPendingSignupToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashPendingSignupToken(token) };
}

/** Writes `socialsignup:{tokenHash} → claim`, TTL fixed by `keys.socialSignup` (DB§15). */
export async function storePendingSignup(
  tokenHash: string,
  claim: PendingSocialSignup,
): Promise<void> {
  const { key, ttlSeconds } = keys.socialSignup(tokenHash);
  await redis.set(key, JSON.stringify(claim), 'EX', ttlSeconds);
}

/**
 * Atomically reads and deletes the pending claim (`GETDEL`) — single-use,
 * same race-safety argument as `./reset-token.ts`'s `consumeResetToken`:
 * Redis is single-threaded per key, so two concurrent submissions of the
 * same token can never both observe a present value. Returns `null` for an
 * unknown, expired, already-consumed, or corrupt-JSON token — collapsed
 * into one outcome deliberately, so a caller holding a leaked token learns
 * nothing about why it failed.
 */
export async function consumePendingSignup(token: string): Promise<PendingSocialSignup | null> {
  const { key } = keys.socialSignup(hashPendingSignupToken(token));
  const raw = await redis.getdel(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as PendingSocialSignup;
  } catch {
    return null;
  }
}
