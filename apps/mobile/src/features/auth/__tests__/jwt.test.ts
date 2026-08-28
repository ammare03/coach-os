import { decodeAccessTokenClaims } from '../jwt.ts';

function makeToken(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

describe('decodeAccessTokenClaims', () => {
  it('reads userId and role from a well-formed token', () => {
    const token = makeToken({ sub: 'user-1', role: 'coach', did: 'device-1' });

    expect(decodeAccessTokenClaims(token)).toEqual({ userId: 'user-1', role: 'coach' });
  });

  it('accepts every role the server can issue', () => {
    for (const role of ['coach', 'client', 'assistant']) {
      const token = makeToken({ sub: 'user-1', role });
      expect(decodeAccessTokenClaims(token)?.role).toBe(role);
    }
  });

  it('returns null for a token with the wrong number of segments', () => {
    expect(decodeAccessTokenClaims('not-a-jwt')).toBeNull();
  });

  it('returns null when sub is missing', () => {
    const token = makeToken({ role: 'coach' });
    expect(decodeAccessTokenClaims(token)).toBeNull();
  });

  it('returns null for an unrecognized role', () => {
    const token = makeToken({ sub: 'user-1', role: 'admin' });
    expect(decodeAccessTokenClaims(token)).toBeNull();
  });

  it('returns null for a payload segment that is not valid JSON', () => {
    expect(decodeAccessTokenClaims('aaaa.not-json.signature')).toBeNull();
  });
});
