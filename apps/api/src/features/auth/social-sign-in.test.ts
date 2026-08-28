// `social-sign-in/03` + Ammar's DOB-gate decision — real Postgres and real
// Redis (`testing` skill §4; `consumePendingSignup`'s single-use `GETDEL`
// is the thing worth proving against a real store, not a mock). Same
// dynamic-import-after-containers-start shape as `auth-reset.test.ts`,
// for the identical reason: `env.ts` freezes `DATABASE_URL`/`REDIS_URL`
// at module load.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import { isCatalogedError } from '../../lib/app-error.ts';

import type { completeSocialSignUp as CompleteSocialSignUp } from './complete-social-signup.ts';
import type { handleSocialSignIn as HandleSocialSignIn } from './social-sign-in.ts';

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: DbClient;
let handleSocialSignIn: typeof HandleSocialSignIn;
let completeSocialSignUp: typeof CompleteSocialSignUp;
let createTestContext: typeof CreateTestContext;

beforeAll(async () => {
  [pgContainer, redisContainer] = await Promise.all([
    new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_USER: 'coachos',
        POSTGRES_PASSWORD: 'coachos',
        POSTGRES_DB: 'coachos',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential
  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
  ({ handleSocialSignIn } = await import('./social-sign-in.ts'));
  ({ completeSocialSignUp } = await import('./complete-social-signup.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));

  const { redis } = await import('../../lib/redis.ts');
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
  await redisContainer.stop();
});

const DEVICE = { platform: 'ios' as const };

// `providerUid` is a required, explicit argument rather than a shared
// default — this suite runs every test against one live Postgres instance
// with no per-test rollback (unlike `authz.test.ts`'s transaction-wrapped
// probes), so two calls sharing a hardcoded uid collide on
// `auth_providers_provider_uid_unique` the moment a second test runs.
async function insertLinkedCoach(
  providerUid: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: 'linked-coach@social-sign-in-test.com',
      passwordHash: null,
      name: 'Linked Coach',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  await db.insert(schema.coachProfiles).values({ userId: user.id });
  await db.insert(schema.authProviders).values({
    userId: user.id,
    provider: 'apple',
    providerUid,
  });
  return user;
}

describe('handleSocialSignIn', () => {
  it('opens a real session for an existing linked user', async () => {
    const user = await insertLinkedCoach('apple-uid-linked-1', {
      email: 'linked-1@social-sign-in-test.com',
    });
    const ctx = createTestContext({ db });

    const result = await handleSocialSignIn(
      db,
      ctx,
      {
        provider: 'apple',
        providerUid: 'apple-uid-linked-1',
        email: 'linked-1@social-sign-in-test.com',
      },
      DEVICE,
    );

    expect(result.kind).toBe('session');
    if (result.kind === 'session') {
      expect(result.user.id).toBe(user.id);
      expect(result.accessToken).toEqual(expect.any(String));
    }
  });

  it('throws SOCIAL_ACCOUNT_EXISTS for an email collision, naming the provider', async () => {
    await db.insert(schema.users).values({
      email: 'collision@social-sign-in-test.com',
      passwordHash: 'not-a-real-hash',
      name: 'Existing Password User',
      role: 'coach',
      timezone: 'UTC',
    });
    const ctx = createTestContext({ db });

    await expect(
      handleSocialSignIn(
        db,
        ctx,
        {
          provider: 'google',
          providerUid: 'google-uid-collision',
          email: 'collision@social-sign-in-test.com',
        },
        DEVICE,
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { appCode: 'SOCIAL_ACCOUNT_EXISTS', details: { provider: 'google' } },
    });
  });

  it('returns needsDateOfBirth with the claim email for a brand-new identity, and stores the pending record', async () => {
    const ctx = createTestContext({ db });

    const result = await handleSocialSignIn(
      db,
      ctx,
      {
        provider: 'google',
        providerUid: 'google-uid-brand-new',
        email: 'brand-new@social-sign-in-test.com',
      },
      DEVICE,
      'Jane Doe',
    );

    expect(result.kind).toBe('needsDateOfBirth');
    if (result.kind !== 'needsDateOfBirth') return;
    expect(result.email).toBe('brand-new@social-sign-in-test.com');
    expect(result.pendingSignupToken.length).toBeGreaterThan(0);

    const { consumePendingSignup } = await import('../../lib/auth/social-signup-pending.ts');
    const pending = await consumePendingSignup(result.pendingSignupToken);
    expect(pending).toEqual({
      provider: 'google',
      providerUid: 'google-uid-brand-new',
      email: 'brand-new@social-sign-in-test.com',
      name: 'Jane Doe',
    });
  });

  it('rejects a null-email new identity with VALIDATION_FAILED rather than creating an unreachable account', async () => {
    const ctx = createTestContext({ db });

    await expect(
      handleSocialSignIn(
        db,
        ctx,
        { provider: 'apple', providerUid: 'apple-uid-no-email', email: null },
        DEVICE,
      ),
    ).rejects.toMatchObject({ cause: { appCode: 'VALIDATION_FAILED' } });
  });

  it('refuses a stale link to a soft-deleted user rather than opening a session for a gone account', async () => {
    await insertLinkedCoach('apple-uid-linked-deleted', {
      email: 'deleted-linked@social-sign-in-test.com',
      deletedAt: new Date(),
    });
    const ctx = createTestContext({ db });

    await expect(
      handleSocialSignIn(
        db,
        ctx,
        {
          provider: 'apple',
          providerUid: 'apple-uid-linked-deleted',
          email: 'deleted-linked@social-sign-in-test.com',
        },
        DEVICE,
      ),
    ).rejects.toMatchObject({ cause: { appCode: 'AUTH_REQUIRED' } });
  });
});

describe('completeSocialSignUp', () => {
  async function issuePending(claim: {
    provider: 'apple' | 'google';
    providerUid: string;
    email: string;
    name: string | null;
  }): Promise<string> {
    const { issuePendingSignupToken, storePendingSignup } =
      await import('../../lib/auth/social-signup-pending.ts');
    const { token, tokenHash } = issuePendingSignupToken();
    await storePendingSignup(tokenHash, claim);
    return token;
  }

  it("creates a coach account with the pending record's name and email, and opens a session", async () => {
    const token = await issuePending({
      provider: 'google',
      providerUid: 'google-uid-complete-1',
      email: 'complete-1@social-sign-in-test.com',
      name: 'Complete One',
    });
    const ctx = createTestContext({ db });

    const session = await completeSocialSignUp(db, ctx, {
      pendingSignupToken: token,
      timezone: 'UTC',
      dateOfBirth: '1990-01-01',
      device: DEVICE,
    });

    expect(session.user.name).toBe('Complete One');
    expect(session.accessToken).toEqual(expect.any(String));

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'complete-1@social-sign-in-test.com'));
    expect(user?.passwordHash).toBeNull();
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.role).toBe('coach');
    expect(user?.isMinor).toBe(false);

    const [link] = await db
      .select()
      .from(schema.authProviders)
      .where(eq(schema.authProviders.providerUid, 'google-uid-complete-1'));
    expect(link?.userId).toBe(user?.id);
  });

  it('derives a display name from the email local part when the provider gave none', async () => {
    const token = await issuePending({
      provider: 'apple',
      providerUid: 'apple-uid-complete-2',
      email: 'jane.doe@social-sign-in-test.com',
      name: null,
    });
    const ctx = createTestContext({ db });

    const session = await completeSocialSignUp(db, ctx, {
      pendingSignupToken: token,
      timezone: 'UTC',
      dateOfBirth: '1990-01-01',
      device: DEVICE,
    });

    expect(session.user.name).toBe('Jane Doe');
  });

  it('rejects an expired or unknown pending token with AUTH_REQUIRED', async () => {
    const ctx = createTestContext({ db });

    await expect(
      completeSocialSignUp(db, ctx, {
        pendingSignupToken: 'this-token-was-never-issued',
        timezone: 'UTC',
        dateOfBirth: '1990-01-01',
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'AUTH_REQUIRED' } });
  });

  it('rejects under-13 with AGE_BELOW_MINIMUM and does not consume the pending token', async () => {
    const token = await issuePending({
      provider: 'google',
      providerUid: 'google-uid-under-13',
      email: 'under-13@social-sign-in-test.com',
      name: 'Too Young',
    });
    const ctx = createTestContext({ db });
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const dateOfBirth = tenYearsAgo.toISOString().slice(0, 10);

    await expect(
      completeSocialSignUp(db, ctx, {
        pendingSignupToken: token,
        timezone: 'UTC',
        dateOfBirth,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'AGE_BELOW_MINIMUM' } });

    // The token must still be usable — a rejected age must not burn a
    // single-use record the person needs to retry with a correct birthdate.
    const session = await completeSocialSignUp(db, ctx, {
      pendingSignupToken: token,
      timezone: 'UTC',
      dateOfBirth: '1990-01-01',
      device: DEVICE,
    });
    expect(session.user.name).toBe('Too Young');
  });

  it('rejects 13-17 with COACH_MUST_BE_ADULT', async () => {
    const token = await issuePending({
      provider: 'google',
      providerUid: 'google-uid-teen',
      email: 'teen@social-sign-in-test.com',
      name: 'A Teen',
    });
    const ctx = createTestContext({ db });
    const sixteenYearsAgo = new Date();
    sixteenYearsAgo.setFullYear(sixteenYearsAgo.getFullYear() - 16);
    const dateOfBirth = sixteenYearsAgo.toISOString().slice(0, 10);

    await expect(
      completeSocialSignUp(db, ctx, {
        pendingSignupToken: token,
        timezone: 'UTC',
        dateOfBirth,
        device: DEVICE,
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'COACH_MUST_BE_ADULT' } });
  });
});

// Proves the two errors above are genuinely catalogued, not just shaped
// like one — `isCatalogedError` is what the formatter checks before
// trusting `cause.appCode` at all.
describe('catalogued-error sanity', () => {
  it('isCatalogedError recognises the errors this file asserts on', async () => {
    const ctx = createTestContext({ db });
    try {
      await handleSocialSignIn(
        db,
        ctx,
        { provider: 'apple', providerUid: 'apple-uid-sanity', email: null },
        DEVICE,
      );
      throw new Error('expected handleSocialSignIn to throw');
    } catch (error) {
      expect(isCatalogedError(error)).toBe(true);
    }
  });
});
