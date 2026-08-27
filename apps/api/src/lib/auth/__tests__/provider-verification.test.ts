// Fixture tokens only — never a live call to Apple or Google (`01`'s
// Verification section). A local key pair stands in for each provider's
// JWKS, injected via `VerifyOverrides` so the module under test exercises
// the exact same `jwtVerify` code path it uses in production.
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { createLocalJWKSet } from 'jose';

import { verifyAppleIdentityToken, verifyGoogleIdToken } from '../provider-verification.ts';

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'test-client-id';
const KID = 'test-key';

interface Fixture {
  jwks: ReturnType<typeof createLocalJWKSet>;
  goodKey: KeyLike;
  wrongKey: KeyLike;
}

async function buildFixture(): Promise<Fixture> {
  const good = await generateKeyPair('RS256', { extractable: true });
  const wrong = await generateKeyPair('RS256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(good.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    goodKey: good.privateKey,
    wrongKey: wrong.privateKey,
  };
}

function sign(
  key: KeyLike,
  payload: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: number | string; kid?: string } = {},
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setExpirationTime(opts.exp ?? '1h')
    .sign(key);
}

describe('verifyAppleIdentityToken', () => {
  let fixture: Fixture;
  const nonce = 'expected-nonce';

  beforeAll(async () => {
    fixture = await buildFixture();
  });

  function verify(token: string, expectedNonce = nonce) {
    return verifyAppleIdentityToken(token, expectedNonce, {
      jwks: fixture.jwks,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  it('returns normalised claims for a well-formed token', async () => {
    const token = await sign(fixture.goodKey, {
      sub: 'apple-user-1',
      email: 'coach@example.com',
      email_verified: 'true',
      nonce,
    });
    await expect(verify(token)).resolves.toEqual({
      provider: 'apple',
      providerUid: 'apple-user-1',
      email: 'coach@example.com',
      emailVerified: true,
      name: null,
    });
  });

  it('rejects a bad signature', async () => {
    // Signed with a key not in the JWKS, but presented under the JWKS's
    // own kid — the signature check itself must fail, not just key lookup.
    const token = await sign(fixture.wrongKey, { sub: 'apple-user-1', nonce });
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects a wrong audience', async () => {
    const token = await sign(
      fixture.goodKey,
      { sub: 'apple-user-1', nonce },
      { aud: 'someone-elses-app' },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects a wrong issuer', async () => {
    const token = await sign(
      fixture.goodKey,
      { sub: 'apple-user-1', nonce },
      { iss: 'https://not-apple.test' },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await sign(
      fixture.goodKey,
      { sub: 'apple-user-1', nonce },
      { exp: Math.floor(Date.now() / 1000) - 60 },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects a mismatched nonce', async () => {
    const token = await sign(fixture.goodKey, { sub: 'apple-user-1', nonce: 'not-the-nonce' });
    await expect(verify(token)).resolves.toBeNull();
  });
});

describe('verifyGoogleIdToken', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture();
  });

  function verify(token: string) {
    return verifyGoogleIdToken(token, { jwks: fixture.jwks, issuer: ISSUER, audience: AUDIENCE });
  }

  it('returns normalised claims for a well-formed token', async () => {
    const token = await sign(fixture.goodKey, {
      sub: 'google-user-1',
      email: 'coach@example.com',
      email_verified: true,
      name: 'Coach Example',
    });
    await expect(verify(token)).resolves.toEqual({
      provider: 'google',
      providerUid: 'google-user-1',
      email: 'coach@example.com',
      emailVerified: true,
      name: 'Coach Example',
    });
  });

  it('treats email_verified: false as unverified, not a rejection', async () => {
    const token = await sign(fixture.goodKey, {
      sub: 'google-user-2',
      email: 'unverified@example.com',
      email_verified: false,
    });
    await expect(verify(token)).resolves.toMatchObject({ emailVerified: false });
  });

  it('rejects a bad signature', async () => {
    const token = await sign(fixture.wrongKey, { sub: 'google-user-1' });
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects a wrong audience', async () => {
    const token = await sign(fixture.goodKey, { sub: 'google-user-1' }, { aud: 'wrong-client' });
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects a wrong issuer', async () => {
    const token = await sign(
      fixture.goodKey,
      { sub: 'google-user-1' },
      { iss: 'https://not-google.test' },
    );
    await expect(verify(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await sign(
      fixture.goodKey,
      { sub: 'google-user-1' },
      { exp: Math.floor(Date.now() / 1000) - 60 },
    );
    await expect(verify(token)).resolves.toBeNull();
  });
});
