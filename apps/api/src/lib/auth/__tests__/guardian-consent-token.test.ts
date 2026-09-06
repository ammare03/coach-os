// Real Redis (`testing` skill §4) — the single-use guarantee this module
// claims is a property of `GETDEL`, not of our code, so a mocked client
// would only test the mock. `env.ts` freezes `REDIS_URL` at module load, so
// every import that could reach it is dynamic, after the container starts
// (`../../../__tests__/auth-reset.test.ts`'s pattern).
import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { keys as Keys } from '../../redis-keys.ts';
import type * as GuardianConsentTokenModule from '../guardian-consent-token.ts';

let redisContainer: StartedTestContainer;
let redis: Redis;
let keys: typeof Keys;
let tokens: typeof GuardianConsentTokenModule;

beforeAll(async () => {
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  tokens = await import('../guardian-consent-token.ts');
  ({ keys } = await import('../../redis-keys.ts'));
  ({ redis } = await import('../../redis.ts'));

  // This suite exercises real single-use enforcement, not the fail-open
  // path — connect up front rather than racing the lazy connection against
  // the first real command (`../../../__tests__/auth-reset.test.ts`).
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await redisContainer.stop();
}, 60_000);

describe('issueGuardianConsentToken', () => {
  it('returns a URL-safe token and its bare SHA-256 digest', () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('never returns the same token twice', () => {
    const first = tokens.issueGuardianConsentToken();
    const second = tokens.issueGuardianConsentToken();

    expect(first.token).not.toBe(second.token);
  });
});

describe('storeGuardianConsentToken', () => {
  it('writes the user id under the hashed key, never the raw token', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();

    await tokens.storeGuardianConsentToken(tokenHash, 'user-stored');

    expect(await redis.get(keys.guardianConsent(tokenHash).key)).toBe('user-stored');
    expect(await redis.exists(keys.guardianConsent(token).key)).toBe(0);
  });

  it('applies the 7-day TTL DB§15 assigns the key', async () => {
    const { tokenHash } = tokens.issueGuardianConsentToken();

    await tokens.storeGuardianConsentToken(tokenHash, 'user-ttl');

    const ttl = await redis.ttl(keys.guardianConsent(tokenHash).key);
    expect(ttl).toBeGreaterThan(7 * 24 * 60 * 60 - 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
  });

  // `guardian-consent/04` — the reverse pointer, written in the same
  // `MULTI`. Without it there is no way to find, and therefore no way to
  // kill, the link a mistyped guardian address already received.
  it('records the token as the outstanding one for that user, and only the newest', async () => {
    const first = tokens.issueGuardianConsentToken();
    const second = tokens.issueGuardianConsentToken();
    const pointer = keys.guardianConsentOutstanding('user-outstanding').key;

    await tokens.storeGuardianConsentToken(first.tokenHash, 'user-outstanding');
    expect(await redis.get(pointer)).toBe(first.tokenHash);

    await tokens.storeGuardianConsentToken(second.tokenHash, 'user-outstanding');
    expect(await redis.get(pointer)).toBe(second.tokenHash);
    const ttl = await redis.ttl(pointer);
    expect(ttl).toBeGreaterThan(7 * 24 * 60 * 60 - 60);
  });
});

describe('revokeOutstandingGuardianConsentToken', () => {
  it('kills the outstanding token and the pointer to it', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-revoked');

    await tokens.revokeOutstandingGuardianConsentToken('user-revoked');

    expect(await redis.exists(keys.guardianConsent(tokenHash).key)).toBe(0);
    expect(await redis.exists(keys.guardianConsentOutstanding('user-revoked').key)).toBe(0);
    expect(await tokens.consumeGuardianConsentToken(token)).toBeNull();
  });

  it('leaves the token of every other user alone', async () => {
    const mine = tokens.issueGuardianConsentToken();
    const theirs = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(mine.tokenHash, 'user-mine');
    await tokens.storeGuardianConsentToken(theirs.tokenHash, 'user-theirs');

    await tokens.revokeOutstandingGuardianConsentToken('user-mine');

    expect(await tokens.consumeGuardianConsentToken(theirs.token)).toBe('user-theirs');
  });

  // The ordinary case on the recovery path: the token this would revoke has
  // already expired or been evicted, which is why a resend was needed.
  it('is a no-op when nothing is outstanding', async () => {
    await expect(
      tokens.revokeOutstandingGuardianConsentToken('user-with-nothing-outstanding'),
    ).resolves.toBeUndefined();
  });
});

describe('consumeGuardianConsentToken', () => {
  it('resolves the stored user id on the first consumption', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-first');

    expect(await tokens.consumeGuardianConsentToken(token)).toBe('user-first');
  });

  it('returns the user id exactly once across two concurrent consumptions', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-concurrent');

    const results = await Promise.all([
      tokens.consumeGuardianConsentToken(token),
      tokens.consumeGuardianConsentToken(token),
    ]);

    expect(results.filter((r) => r !== null)).toEqual(['user-concurrent']);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it('returns null for an unknown token', async () => {
    const { token } = tokens.issueGuardianConsentToken();

    expect(await tokens.consumeGuardianConsentToken(token)).toBeNull();
  });

  it('returns null for an already-used token', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-reused');
    await tokens.consumeGuardianConsentToken(token);

    expect(await tokens.consumeGuardianConsentToken(token)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-expired');
    // Expire it now rather than waiting out the real 7 days.
    await redis.pexpire(keys.guardianConsent(tokenHash).key, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await tokens.consumeGuardianConsentToken(token)).toBeNull();
  });

  it('deletes the key, so nothing outlives the one consumption', async () => {
    const { token, tokenHash } = tokens.issueGuardianConsentToken();
    await tokens.storeGuardianConsentToken(tokenHash, 'user-deleted');

    await tokens.consumeGuardianConsentToken(token);

    expect(await redis.exists(keys.guardianConsent(tokenHash).key)).toBe(0);
  });
});
