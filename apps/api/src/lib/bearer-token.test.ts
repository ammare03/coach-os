import { parseBearerToken } from './bearer-token.ts';

describe('parseBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns null for a missing header', () => {
    expect(parseBearerToken(null)).toBeNull();
  });

  it('returns null when the scheme is not exactly "Bearer "', () => {
    expect(parseBearerToken('Basic abc123')).toBeNull();
    expect(parseBearerToken('bearer abc123')).toBeNull();
  });

  it('returns null for "Bearer " with nothing after it', () => {
    expect(parseBearerToken('Bearer ')).toBeNull();
    expect(parseBearerToken('Bearer    ')).toBeNull();
  });
});
