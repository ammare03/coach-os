// Real Postgres (`testing` skill §4) — the idempotent `ON CONFLICT (user_id)
// DO NOTHING` upsert (`account-lifecycle/03` Acceptance criteria: a repeat
// call must not reset the grace window) is exactly the kind of behaviour
// worth proving against a real unique/primary-key conflict.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import { clearSessionCache } from '../../lib/auth/session-cache.ts';

import type { cancelDeletion as CancelDeletion } from './cancel-deletion.ts';
import type { requestDeletion as RequestDeletion } from './request-deletion.ts';

const clearSessionCacheMock = clearSessionCache as jest.MockedFunction<typeof clearSessionCache>;

// Stubbed at the boundary, same pattern as `../invites/create-invite.test.ts`
// — a real Resend call against the fake test API key would otherwise fire
// (and log its 401) after this suite's `afterAll` has already torn down the
// Postgres pool, since `sendDeletionRecoveryEmail` is deliberately
// fire-and-forget (`account-lifecycle/03`).
jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mocked rather than exercised against a real Redis, because there isn't
// one in this suite and `safeRedis` swallows the failure of the one that
// isn't there — meaning a missing `clearSessionCache` call would be
// indistinguishable from a present one. The module boundary is the only
// place the call is observable (`account-actions/02`: "a cached session
// cannot outlive the state change by up to 15 minutes").
jest.mock('../../lib/auth/session-cache.ts', () => ({
  clearSessionCache: jest.fn().mockResolvedValue(undefined),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let requestDeletion: typeof RequestDeletion;
let cancelDeletion: typeof CancelDeletion;
let createTestContext: typeof CreateTestContext;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
  ({ requestDeletion } = await import('./request-deletion.ts'));
  ({ cancelDeletion } = await import('./cancel-deletion.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;

async function insertUser(): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `user-${seq}@deletion-request-test.com`;
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'argon2id$placeholder',
      name: `User ${seq}`,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  return { id: user.id, email };
}

describe('requestDeletion', () => {
  it('creates a pending row with scheduledPurgeAt ~7 days out and an audit entry', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });

    const request = await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    expect(request.userId).toBe(user.id);
    const daysOut =
      (request.scheduledPurgeAt.getTime() - request.requestedAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysOut).toBeCloseTo(7, 1);

    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, user.id));
    expect(entry?.action).toBe('account.deletion_requested');
  });

  it('does not reset scheduledPurgeAt on a repeat call, and writes no second audit entry', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });

    const first = await requestDeletion(db, ctx, user.id, user.email, 'UTC');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    expect(second.scheduledPurgeAt.getTime()).toBe(first.scheduledPurgeAt.getTime());

    const entries = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, user.id));
    expect(entries).toHaveLength(1);
  });
});

describe('cancelDeletion', () => {
  it('removes a pending request and writes an audit entry', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });
    await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    await cancelDeletion(db, ctx, user.id);

    const [row] = await db
      .select()
      .from(schema.deletionRequests)
      .where(eq(schema.deletionRequests.userId, user.id));
    expect(row).toBeUndefined();

    const entries = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, user.id));
    expect(entries.map((e) => e.action)).toContain('account.deletion_cancelled');
  });

  it('is a quiet no-op with nothing pending', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });

    await expect(cancelDeletion(db, ctx, user.id)).resolves.toBeUndefined();

    const entries = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, user.id));
    expect(entries).toHaveLength(0);
  });

  it('allows requesting deletion again after a cancellation', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });
    await requestDeletion(db, ctx, user.id, user.email, 'UTC');
    await cancelDeletion(db, ctx, user.id);

    const request = await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    expect(request.userId).toBe(user.id);
  });
});

// `account-actions/02`: DB§15's session cache has a 15-minute TTL, so
// without an explicit clear a second device keeps being served a cached
// session — coaching for a quarter of an hour after the account started
// winding down, or being shown the blocking screen for a quarter of an hour
// after tapping Restore. Both directions are tested, because only clearing
// on one of them is the shape of bug that reads as "sometimes it takes a
// while to work".
describe('session cache', () => {
  beforeEach(() => {
    clearSessionCacheMock.mockClear();
  });

  it('is cleared for every device when a deletion is requested', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });

    await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    // One argument, never two: the `deviceId` overload clears one device,
    // and the device that asked to delete is not the only one that must
    // stop being served from cache.
    expect(clearSessionCacheMock).toHaveBeenCalledWith(user.id);
    expect(clearSessionCacheMock.mock.calls[0]).toHaveLength(1);
  });

  it('is cleared for every device when a deletion is cancelled', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });
    await requestDeletion(db, ctx, user.id, user.email, 'UTC');
    clearSessionCacheMock.mockClear();

    await cancelDeletion(db, ctx, user.id);

    expect(clearSessionCacheMock).toHaveBeenCalledWith(user.id);
    expect(clearSessionCacheMock.mock.calls[0]).toHaveLength(1);
  });

  it('is still cleared when the cancel was a no-op', async () => {
    // A person who taps Restore twice, or who followed the recovery email
    // after already restoring in the app, must not have the second tap be
    // the one that leaves a stale session behind.
    const user = await insertUser();
    const ctx = createTestContext({ db });

    await cancelDeletion(db, ctx, user.id);

    expect(clearSessionCacheMock).toHaveBeenCalledWith(user.id);
  });
});

// P03's idempotency, re-asserted from this task's angle rather than
// duplicated: `requestDeletion` above already proves the timestamp does not
// move, and this proves the thing the pending screen depends on — that the
// date `me.get` will report is the same date after a repeat call, so a
// second request (however it were reached) could never extend the window
// the user was shown.
describe('repeat requests and the reported purge date', () => {
  it('reports the same scheduled purge date to me.get after a repeat call', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });

    const first = await requestDeletion(db, ctx, user.id, user.email, 'UTC');
    const { getMe } = await import('./get-me.ts');
    const beforeRepeat = await getMe(db, user.id);
    await requestDeletion(db, ctx, user.id, user.email, 'UTC');
    const afterRepeat = await getMe(db, user.id);

    expect(beforeRepeat.deletionScheduledFor?.getTime()).toBe(first.scheduledPurgeAt.getTime());
    expect(afterRepeat.deletionScheduledFor?.getTime()).toBe(first.scheduledPurgeAt.getTime());
  });

  it('reports null once the request is cancelled', async () => {
    const user = await insertUser();
    const ctx = createTestContext({ db });
    await requestDeletion(db, ctx, user.id, user.email, 'UTC');

    await cancelDeletion(db, ctx, user.id);

    const { getMe } = await import('./get-me.ts');
    expect((await getMe(db, user.id)).deletionScheduledFor).toBeNull();
  });
});
