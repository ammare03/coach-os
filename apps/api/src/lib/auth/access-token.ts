// Mints and verifies the 15-minute bearer access token (`03`). The only
// module that signs one; `../../trpc/auth-verifier.ts` is the only module
// that verifies one — everything else in the codebase treats a token as
// opaque.
import { jwtVerify, SignJWT } from 'jose';
import { uuidv7 } from 'uuidv7';

import { env } from '../../env.ts';

import type { AuthClaims } from './claims.ts';

// One service verifies these tokens and §16.1 already declares a single
// `JWT_SECRET` — HS256 is the right choice for exactly one verifying party.
// Asymmetric signing buys the ability for a *second* party to verify
// without holding the signing key; the day that's needed (a separate
// WebSocket gateway, an edge worker), the move is an asymmetric algorithm
// with published keys, and that's a `CLAUDE.md` §27 decision, not a quiet
// change here.
const ALGORITHM = 'HS256';
const ISSUER = 'coachos-api';
const AUDIENCE = 'coachos-app';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

export interface IssueAccessTokenInput {
  userId: string;
  role: 'coach' | 'client' | 'assistant';
  deviceId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

/**
 * The claim set is closed — exactly `sub`, `role`, `did`, `jti`, `iat`,
 * `exp`, `iss`, `aud` (`03`'s Produces table). Adding a claim needs a note
 * in that task document: a claim is a cache, and a cache in a 15-minute
 * bearer token can be stale for the whole 15 minutes. Deliberately absent:
 * email, name, timezone, locale, `coachProfileId`, entitlements — personal
 * data, or exactly the kind of thing that must be re-read every request,
 * not cached in a token a device stores on disk.
 */
export async function issueAccessToken(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const token = await new SignJWT({ role: input.role, did: input.deviceId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(input.userId)
    .setJti(uuidv7())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(secretKey);
  return { token, expiresAt };
}

/**
 * Verifies a token and returns its claims, or `null` for any failure —
 * expired, malformed, wrong signature, wrong `iss`/`aud`, or an algorithm
 * other than `HS256` (`algorithms: [ALGORITHM]` below pins it explicitly,
 * so a token that claims `alg: none` or any other algorithm in its own
 * header is rejected before signature checking, never trusted from the
 * header). Never throws — this is `auth.refresh`'s verifier too, and a
 * public procedure that legitimately receives an expired token must get a
 * `null`, not an unhandled rejection (`api-scaffold/02`'s same rule for
 * `AuthVerifier`).
 */
export async function verifyAccessToken(token: string): Promise<AuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.did !== 'string' ||
      payload.did.length === 0 ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    return { userId: payload.sub, deviceId: payload.did, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}
