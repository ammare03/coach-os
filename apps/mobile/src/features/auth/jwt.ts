// Reads the `sub` and `role` claims out of the access token's payload
// segment, without verifying the signature — the server
// (`apps/api/src/lib/auth/access-token.ts`) is the only thing that ever
// verifies one; the client only needs to render UI (which role's home
// screen) before the network answers. A forged claim here gains nothing:
// every procedure re-derives `ctx.user` from a signature-verified token
// server-side (CLAUDE.md §6.2).
//
// No `atob` / `Buffer` — neither is guaranteed to exist in Hermes without a
// polyfill this app has no other reason to carry (CLAUDE.md §3.4: don't add
// a dependency for a dozen lines of pure JS).
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlDecode(segment: string): string {
  let bits = '';
  for (const char of segment) {
    const index = BASE64URL_ALPHABET.indexOf(char);
    if (index === -1) continue; // skips '=' padding and anything stray
    bits += index.toString(2).padStart(6, '0');
  }

  let percentEncoded = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const byte = parseInt(bits.slice(i, i + 8), 2);
    percentEncoded += '%' + byte.toString(16).padStart(2, '0');
  }
  return decodeURIComponent(percentEncoded);
}

// Matches `IssueAccessTokenInput['role']` on the server — `'assistant'` is
// unused before P25, but the token can carry it today, and narrowing it
// away here would make this function lie about what it read.
export type AccessTokenRole = 'coach' | 'client' | 'assistant';

export interface AccessTokenClaims {
  userId: string;
  role: AccessTokenRole;
}

const VALID_ROLES: readonly AccessTokenRole[] = ['coach', 'client', 'assistant'];

/** Returns null for anything malformed rather than throwing — a decode
 * failure means "treat as signed out", not a crash on cold start. */
export function decodeAccessTokenClaims(accessToken: string): AccessTokenClaims | null {
  const parts = accessToken.split('.');
  const payloadSegment = parts[1];
  if (parts.length !== 3 || payloadSegment === undefined) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(base64UrlDecode(payloadSegment));
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('sub' in payload) ||
      !('role' in payload) ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      typeof payload.role !== 'string' ||
      !VALID_ROLES.includes(payload.role as AccessTokenRole)
    ) {
      return null;
    }

    return { userId: payload.sub, role: payload.role as AccessTokenRole };
  } catch {
    return null;
  }
}
