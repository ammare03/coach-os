import { verifyAccessToken } from '../lib/auth/access-token.ts';
import type { AuthClaims } from '../lib/auth/claims.ts';

export type { AuthClaims };

// Given a raw bearer token, return its claims or null. Nothing else in the
// codebase parses a token — `../lib/auth/access-token.ts` is the only file
// that verifies one (`auth-server/03`'s AC), this is only the seam.
export type AuthVerifier = (token: string) => Promise<AuthClaims | null> | AuthClaims | null;

// The real verifier (`auth-server/03`). Every authenticated procedure in
// the product goes live the moment this resolves a token instead of
// rejecting it — `api-scaffold/02` shipped the reject-everything default
// specifically so this file, not a stubbed "always user 1" verifier, is
// what turns it on.
export const defaultAuthVerifier: AuthVerifier = verifyAccessToken;
