import { SignJWT } from 'jose';

import { issueAccessToken, verifyAccessToken } from '../access-token.ts';

const ISSUER = 'coachos-api';
const AUDIENCE = 'coachos-app';

function base64url(input: object): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function decodePayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) throw new Error('token has no payload segment');
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
}

describe('issueAccessToken / verifyAccessToken', () => {
  it('round-trips: a real token verifies and resolves the right claims', async () => {
    const { token, expiresAt } = await issueAccessToken({
      userId: 'user-1',
      role: 'coach',
      deviceId: 'device-1',
    });
    const claims = await verifyAccessToken(token);
    // `exp` is second-precision JWT-wide (RFC 7519) — the round-tripped
    // value can only match to the nearest second, not the original's
    // millisecond precision.
    expect(claims).toMatchObject({ userId: 'user-1', deviceId: 'device-1' });
    expect(claims?.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -4);
  });

  it('expires 15 minutes after issue', async () => {
    const { expiresAt } = await issueAccessToken({ userId: 'u', role: 'coach', deviceId: 'd' });
    const deltaMs = expiresAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(14 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it('the claim set is exactly sub, role, did, jti, iat, exp, iss, aud', async () => {
    const { token } = await issueAccessToken({ userId: 'u', role: 'coach', deviceId: 'd' });
    const payload = decodePayload(token);
    expect(Object.keys(payload).sort()).toEqual(
      ['aud', 'did', 'exp', 'iat', 'iss', 'jti', 'role', 'sub'].sort(),
    );
  });

  it('contains no email, name, timezone, or locale', async () => {
    const { token } = await issueAccessToken({ userId: 'u', role: 'coach', deviceId: 'd' });
    const payload = decodePayload(token);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('timezone');
    expect(payload).not.toHaveProperty('locale');
    expect(payload).not.toHaveProperty('coachProfileId');
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({ role: 'coach', did: 'd' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setJti('jti-1')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await new SignJWT({ role: 'coach', did: 'd' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setJti('jti-1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(new TextEncoder().encode('a-completely-different-secret-value-32c'));
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token with the wrong issuer', async () => {
    const token = await new SignJWT({ role: 'coach', did: 'd' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setJti('jti-1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer('someone-elses-api')
      .setAudience(AUDIENCE)
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await new SignJWT({ role: 'coach', did: 'd' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setJti('jti-1')
      .setIssuedAt()
      .setExpirationTime('15m')
      .setIssuer(ISSUER)
      .setAudience('someone-elses-app')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an alg: none token before signature checking', async () => {
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({
      sub: 'u',
      did: 'd',
      role: 'coach',
      jti: 'jti-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
      iss: ISSUER,
      aud: AUDIENCE,
    });
    const token = `${header}.${payload}.`;
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a garbage string', async () => {
    await expect(verifyAccessToken('not-a-jwt-at-all')).resolves.toBeNull();
  });
});
