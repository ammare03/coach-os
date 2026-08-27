// The fallback-path replacement for a Better Auth instance — see
// `./adoption.md` for why. This module owns the two cached remote JWKS
// clients and the issuer/audience constants `./provider-verification.ts`
// checks every inbound token against. Nothing here touches the database,
// issues a session, sends an email, or rate-limits anything — each of those
// has an owner named in `./adoption.md`'s table, and none of them is this
// file:
//
//   session persistence   → NOT built here. `identity.refresh_tokens`
//                            rotation families (auth-server/04), not a
//                            Better Auth session table.
//   cookie session         → NOT built here. Access tokens are bearer JWTs
//                            verified by `../../trpc/auth-verifier.ts`
//                            (auth-server/03); nothing sets a cookie.
//   rate limiting           → NOT built here. `../../trpc/procedures.ts`'s
//                            `authProcedure` already applies
//                            `authRateLimit` (P02 rate-limiting) to every
//                            `auth.*` procedure.
//   email sender             → NOT built here. Resend + React Email
//                            (auth-server/06), triggered from a procedure,
//                            never from this module.
import { createRemoteJWKSet } from 'jose';

import { env } from '../../env.ts';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
export const APPLE_AUDIENCE = env.APPLE_SIGN_IN_CLIENT_ID;

export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
// Multiple valid audiences: a native app has one OAuth client id per
// platform (iOS, Android), and either may legitimately sign an inbound
// token. `jwtVerify`'s own `audience` option accepts an array and accepts
// the token if any entry matches.
export const GOOGLE_AUDIENCES = env.GOOGLE_SIGN_IN_CLIENT_IDS.split(',').map((id) => id.trim());

// Module scope, created once per process — not per request or per call.
// `createRemoteJWKSet` caches keys by `kid` internally and only re-fetches
// on a cache miss, with a cooldown between re-fetches for a still-unknown
// `kid` (jose's default 30s) — this is what makes "an unknown key id
// triggers at most one fetch" true without this file implementing its own
// cache.
export const appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);
export const googleJwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
