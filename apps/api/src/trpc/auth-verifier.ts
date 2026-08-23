export interface AuthClaims {
  userId: string;
  deviceId: string;
  expiresAt: Date;
}

// Given a raw bearer token, return its claims or null. Nothing else in the
// codebase parses a token. `phase-03-identity-and-auth/auth-server/03-access-token-issuance.md`
// supplies the real JWT implementation.
export type AuthVerifier = (token: string) => Promise<AuthClaims | null> | AuthClaims | null;

// Rejects every token, so the API is anonymous-only until P03 lands. A
// permissive default here would be a development backdoor reaching
// production undetected — inject a real verifier in a test, never here.
export const defaultAuthVerifier: AuthVerifier = () => null;
