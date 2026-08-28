// Generation and the keyed digest for a refresh token (`04`) — the only
// module that knows the token format. Opaque, 256 bits of CSPRNG entropy,
// never a JWT: a JWT refresh token invites verification without a database
// lookup, and the database lookup *is* the revocation mechanism
// (`04`'s Produces section) — `../../features/auth/rotate-refresh-token.ts`
// is what makes that lookup atomic.
import { createHmac, randomBytes } from 'node:crypto';

import { uuidv7 } from 'uuidv7';

import { env } from '../../env.ts';

const TOKEN_BYTES = 32; // 256 bits of CSPRNG output
export const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * Not Argon2id: the input is already 256 bits of uniform random, there is
 * nothing to guess, and a slow hash would put tens of milliseconds on the
 * most frequent auth operation in the product. Not bare SHA-256 either:
 * keyed under `REFRESH_TOKEN_SECRET` (§16.1) buys a second operational
 * capability worth having on top of DB§5.1's "SHA-256, never store the raw
 * token" — **rotating `REFRESH_TOKEN_SECRET` invalidates every refresh
 * token in the product at once**, the companion to `access-token.ts`'s
 * `JWT_SECRET` rotation. Deterministic (no per-row salt), because
 * `token_hash UNIQUE` is a lookup key — a per-row salt would make lookup
 * require a table scan instead.
 */
export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.REFRESH_TOKEN_SECRET).update(token).digest('hex');
}

export interface IssueRefreshTokenInput {
  /** Omit to open a new family (sign-up, sign-in, social sign-in, invite acceptance). Supply to continue one — only rotation does. */
  familyId?: string;
}

export interface IssuedRefreshToken {
  /** The raw token — returned to the caller once, over TLS, and never stored. */
  token: string;
  /** The keyed digest — what actually goes in `identity.refresh_tokens.token_hash`. */
  tokenHash: string;
  expiresAt: Date;
  familyId: string;
}

/**
 * Pure: generates the token and its digest and, when `familyId` is
 * omitted, a fresh one — no database access. The caller inserts the row;
 * this function does not, because the initial "open a family" insert
 * (sign-up, sign-in) and the rotation insert (`rotate-refresh-token.ts`,
 * inside its one atomic transaction) have different enough transactional
 * shapes that folding both into this module would give it a database
 * dependency it doesn't otherwise need.
 */
export function issueRefreshToken(input: IssueRefreshTokenInput = {}): IssuedRefreshToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    familyId: input.familyId ?? uuidv7(),
  };
}
