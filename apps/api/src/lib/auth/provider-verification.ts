// Verifies an Apple or Google identity token against the provider's own
// published JWKS. Pure functions only (`01-better-auth-integration.md`
// Approach step 5): a token in, a normalised claim or `null` out. No
// database access, no user creation, no side effects — `../../../social-sign-in/03`
// is the only place a verified claim ever turns into a user row. Nothing
// else in the codebase parses a provider token; if a future feature needs
// one verified, it calls these two functions, never `jwtVerify` directly.
import { jwtVerify } from 'jose';
import type { createRemoteJWKSet, JWTVerifyGetKey } from 'jose';

import {
  APPLE_AUDIENCE,
  APPLE_ISSUER,
  GOOGLE_AUDIENCES,
  GOOGLE_ISSUER,
  appleJwks,
  googleJwks,
} from './config.ts';

export interface ProviderClaim {
  provider: 'apple' | 'google';
  providerUid: string; // the token's `sub`
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

// Injectable for tests only — `./__tests__/provider-verification.test.ts`
// signs fixture tokens against an in-memory key pair (`jose.createLocalJWKSet`)
// so this suite never makes a network call to Apple or Google
// (`01`'s Verification section: "a test that calls Apple is not a test, it
// is an outage waiting for CI"). Production call sites never pass this.
export interface VerifyOverrides {
  jwks?: JWTVerifyGetKey | ReturnType<typeof createRemoteJWKSet>;
  issuer?: string;
  audience?: string | string[];
}

// Apple's `email_verified` claim is documented as a boolean but has shipped
// as the string `"true"`/`"false"` from some client versions — read leniently
// rather than trust either shape alone.
function readBoolishClaim(value: unknown): boolean {
  return value === true || value === 'true';
}

function readStringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Verifies a Sign In with Apple identity token. Rejects (`null`) on a bad
 * signature, a wrong `aud`, a wrong `iss`, an expired `exp`, or a `nonce`
 * claim that doesn't match `expectedNonce` — the fifth check `jwtVerify`
 * itself can't make, since the expected value is per-request, not fixed
 * configuration. Apple's identity token never carries a name; the caller
 * gets it (once, on first sign-in only) from the authorization response,
 * not from here.
 */
export async function verifyAppleIdentityToken(
  token: string,
  expectedNonce: string,
  overrides?: VerifyOverrides,
): Promise<ProviderClaim | null> {
  try {
    const { payload } = await jwtVerify(token, overrides?.jwks ?? appleJwks, {
      issuer: overrides?.issuer ?? APPLE_ISSUER,
      audience: overrides?.audience ?? APPLE_AUDIENCE,
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    if (payload.nonce !== expectedNonce) {
      return null;
    }

    return {
      provider: 'apple',
      providerUid: payload.sub,
      email: readStringClaim(payload.email),
      emailVerified: readBoolishClaim(payload.email_verified),
      name: null,
    };
  } catch {
    // Bad signature, wrong aud/iss, expired exp, malformed token, or a JWKS
    // fetch failure all land here — every one of them is a rejection, never
    // a throw. A JWKS outage at Apple must not become a 500 in our sign-in
    // path (01's Risks: "Apple's key endpoint being slow should not make
    // sign-in slow").
    return null;
  }
}

/**
 * Verifies a Google ID token. Rejects (`null`) on the same four structural
 * cases as Apple. `email_verified: false` is passed through as an
 * unverified claim rather than rejected outright — the caller (task 02)
 * decides what an unverified social email means for account creation, this
 * function only reports what the token says.
 */
export async function verifyGoogleIdToken(
  token: string,
  overrides?: VerifyOverrides,
): Promise<ProviderClaim | null> {
  try {
    const { payload } = await jwtVerify(token, overrides?.jwks ?? googleJwks, {
      issuer: overrides?.issuer ?? GOOGLE_ISSUER,
      audience: overrides?.audience ?? GOOGLE_AUDIENCES,
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }

    return {
      provider: 'google',
      providerUid: payload.sub,
      email: readStringClaim(payload.email),
      emailVerified: readBoolishClaim(payload.email_verified),
      name: readStringClaim(payload.name),
    };
  } catch {
    return null;
  }
}
