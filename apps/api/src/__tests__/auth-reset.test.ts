// `auth-server/06` — real Postgres and real Redis (`testing` skill §4);
// `sendEmail` is stubbed at the boundary the task names for exactly this
// reason. `env.ts` freezes `DATABASE_URL`/`REDIS_URL` at module load, so
// everything that could transitively touch either is a dynamic `import()`
// inside `beforeAll`, after both containers start — `context.test.ts`'s
// pattern, applied to every module this file needs (`auth-session.test.ts`'s
// own note on why a partial fix isn't enough).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { appRouter as AppRouter } from '../routers/index.ts';

import type { createTestContext as CreateTestContext } from './test-context.ts';

jest.mock('../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let db: DbClient;
let appRouter: typeof AppRouter;
let createTestContext: typeof CreateTestContext;
let sendEmailMock: jest.Mock;

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
  ({ appRouter } = await import('../routers/index.ts'));
  ({ createTestContext } = await import('./test-context.ts'));
  ({ sendEmail: sendEmailMock } = (await import('../lib/email/client.ts')) as unknown as {
    sendEmail: jest.Mock;
  });

  // This suite exercises real enforcement (the per-email and per-IP rate
  // limits, `GETDEL`'s single-use guarantee) rather than the fail-open
  // path — `rate-limit.test.ts`'s own reasoning for connecting up front
  // instead of racing the lazy connection against the first real command.
  const { redis } = await import('../lib/redis.ts');
  await redis.connect();
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
  await redisContainer.stop();
});

beforeEach(() => {
  sendEmailMock.mockClear();
});

// `auth.*` shares a 10-per-15-minute bucket keyed by IP (`authProcedure`),
// and this suite's real Redis instance carries that counter across every
// test in the file. `ip` defaults to a value unique enough per call site
// (callers below pass the test's own email) that no two tests contend for
// the same bucket — a production concern this file must route around, not
// reproduce.
function caller(ip = 'default-test-ip') {
  const ctx = createTestContext({ db });
  ctx.request.trustedIp = ip;
  return appRouter.createCaller(ctx);
}

// `requestReset` returns before its own work finishes (Argon2id-adjacent
// hashing, a Redis round trip, the mocked send), so the assertions below
// have to wait for a fire-and-forget chain.
//
// They wait for the OUTCOME, never for a duration. A fixed sleep here was
// the previous approach and it passed this file in isolation while failing
// the full `pnpm --filter api test` run: 70-odd suites hash concurrently,
// the deliberately-expensive Argon2 work loses the CPU, and any budget
// tuned on an idle machine becomes a coin flip under load. Polling costs
// nothing when the work is already done and cannot be out-raced when it
// is not.
async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) throw new Error(`timed out after 10s waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Wait until the reset email has actually been handed to `sendEmail`. */
function waitForResetEmail(): Promise<void> {
  return waitFor(() => sendEmailMock.mock.calls.length >= 1, 'the reset email to be sent');
}

// Proving an email was NOT sent is the one case with no condition to poll:
// absence is only ever "nothing yet". This stays a bounded wait, and is
// deliberately far longer than the 50ms it replaces — a false pass here is
// silent, so buy margin the positive cases no longer need to.
function waitForSendToSettle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

async function seedCoach(email: string) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: null,
      name: 'Reset Test',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(), // social-only shape — no password_hash
    })
    .returning();
  if (!user) throw new Error('seed insert did not return a row');
  await db.insert(schema.coachProfiles).values({ userId: user.id });
  return user;
}

describe('auth.requestReset', () => {
  it('returns the same response for a known and an unknown address', async () => {
    await seedCoach('known@reset-test.com');
    const ip = 'ip-known-unknown';
    const known = await caller(ip).auth.requestReset({ email: 'known@reset-test.com' });
    const unknown = await caller(ip).auth.requestReset({ email: 'unknown@reset-test.com' });
    expect(known).toEqual(unknown);
    expect(known).toEqual({ success: true });
  });

  it('sends an email only when the account exists', async () => {
    await seedCoach('sends@reset-test.com');
    const ip = 'ip-sends';
    await caller(ip).auth.requestReset({ email: 'sends@reset-test.com' });
    await caller(ip).auth.requestReset({ email: 'does-not-exist@reset-test.com' });
    await waitForResetEmail();
    // ...and settle, so a wrongly-sent second email fails this rather than
    // arriving just after the assertion.
    await waitForSendToSettle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0]?.[0]).toMatchObject({ to: 'sends@reset-test.com' });
  });

  it('produces no token for a soft-deleted user', async () => {
    const user = await seedCoach('deleted@reset-test.com');
    await db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, user.id));
    await caller('ip-deleted').auth.requestReset({ email: 'deleted@reset-test.com' });
    await waitForSendToSettle();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('writes an audit_log row for a real request, with no email in it', async () => {
    const user = await seedCoach('audited@reset-test.com');
    await caller('ip-audited').auth.requestReset({ email: 'audited@reset-test.com' });
    await waitFor(async () => {
      const written = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'auth.reset.requested'));
      return written.some((r) => r.targetId === user.id);
    }, 'the audit_log row to be written');
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.reset.requested'));
    const forUser = rows.filter((r) => r.targetId === user.id);
    expect(forUser).toHaveLength(1);
    expect(JSON.stringify(forUser[0])).not.toContain('audited@reset-test.com');
  });
});

describe('auth.resetPassword', () => {
  async function requestAndCaptureToken(email: string, ip: string): Promise<string> {
    await caller(ip).auth.requestReset({ email });
    await waitForResetEmail();
    const call = sendEmailMock.mock.calls.at(-1);
    // `PasswordResetEmail({ resetUrl })` is called directly, not written as
    // JSX (`../features/auth/password-reset.ts`) — it returns the
    // `<EmailLayout>` element its body produces, whose own `actionUrl` prop
    // is exactly the `resetUrl` it was given.
    const react = call?.[0]?.react as { props?: { actionUrl?: string } } | undefined;
    const resetUrl = react?.props?.actionUrl;
    if (!resetUrl) throw new Error('no reset email was sent');
    const token = resetUrl.split('/').pop();
    if (!token) throw new Error('reset URL had no token segment');
    return token;
  }

  it('resets the password, and the old password stops working while the new one signs in', async () => {
    const ip = 'ip-completes';
    const user = await seedCoach('completes@reset-test.com');
    // Give the account a real password first so we can prove the *old* one dies.
    const oldHash = (await import('../lib/auth/password.ts')).hashPassword;
    await db
      .update(schema.users)
      .set({ passwordHash: await oldHash('old-password-123') })
      .where(eq(schema.users.id, user.id));

    const token = await requestAndCaptureToken('completes@reset-test.com', ip);
    await expect(
      caller(ip).auth.resetPassword({ token, newPassword: 'brand-new-password-456' }),
    ).resolves.toEqual({ success: true });

    await expect(
      caller(ip).auth.signIn({
        email: 'completes@reset-test.com',
        password: 'old-password-123',
        platform: 'ios',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      caller(ip).auth.signIn({
        email: 'completes@reset-test.com',
        password: 'brand-new-password-456',
        platform: 'ios',
      }),
    ).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('lets a social-only account set a password without touching auth_providers', async () => {
    const ip = 'ip-social';
    const user = await seedCoach('social@reset-test.com');
    await db
      .insert(schema.authProviders)
      .values({ userId: user.id, provider: 'google', providerUid: 'g-123' });

    const token = await requestAndCaptureToken('social@reset-test.com', ip);
    await caller(ip).auth.resetPassword({ token, newPassword: 'a-new-password-789' });

    const providerRows = await db
      .select()
      .from(schema.authProviders)
      .where(eq(schema.authProviders.userId, user.id));
    expect(providerRows).toHaveLength(1);
    await expect(
      caller(ip).auth.signIn({
        email: 'social@reset-test.com',
        password: 'a-new-password-789',
        platform: 'ios',
      }),
    ).resolves.toMatchObject({ user: { id: user.id } });
  });

  it('revokes every refresh family for the user', async () => {
    const ip = 'ip-revokes';
    const user = await seedCoach('revokes@reset-test.com');
    const hashPassword = (await import('../lib/auth/password.ts')).hashPassword;
    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword('a-real-password') })
      .where(eq(schema.users.id, user.id));

    const sessionA = await caller(ip).auth.signIn({
      email: 'revokes@reset-test.com',
      password: 'a-real-password',
      platform: 'ios',
    });
    const sessionB = await caller(ip).auth.signIn({
      email: 'revokes@reset-test.com',
      password: 'a-real-password',
      platform: 'android',
    });

    const token = await requestAndCaptureToken('revokes@reset-test.com', ip);
    await caller(ip).auth.resetPassword({ token, newPassword: 'yet-another-password-000' });

    await expect(
      caller(ip).auth.refresh({ refreshToken: sessionA.refreshToken }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      caller(ip).auth.refresh({ refreshToken: sessionB.refreshToken }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a used token, an unknown token, and an expired-equivalent (already-consumed) token identically', async () => {
    const ip = 'ip-single-use';
    await seedCoach('single-use@reset-test.com');
    const token = await requestAndCaptureToken('single-use@reset-test.com', ip);

    await caller(ip).auth.resetPassword({ token, newPassword: 'first-use-password-1' });
    const reuse = await caller(ip)
      .auth.resetPassword({ token, newPassword: 'second-use-password-2' })
      .catch((e) => e);
    const unknown = await caller(ip)
      .auth.resetPassword({ token: 'never-issued-token', newPassword: 'whatever-password-3' })
      .catch((e) => e);

    expect(reuse).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(unknown).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(reuse.message).toBe(unknown.message);
  });

  it('two concurrent submissions of the same token result in exactly one password change', async () => {
    const ip = 'ip-concurrent';
    await seedCoach('concurrent@reset-test.com');
    const token = await requestAndCaptureToken('concurrent@reset-test.com', ip);

    const outcomes = await Promise.allSettled([
      caller(ip).auth.resetPassword({ token, newPassword: 'concurrent-password-a' }),
      caller(ip).auth.resetPassword({ token, newPassword: 'concurrent-password-b' }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
  });
});
