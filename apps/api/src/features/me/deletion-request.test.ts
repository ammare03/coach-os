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

import type { cancelDeletion as CancelDeletion } from './cancel-deletion.ts';
import type { requestDeletion as RequestDeletion } from './request-deletion.ts';

// Stubbed at the boundary, same pattern as `../invites/create-invite.test.ts`
// — a real Resend call against the fake test API key would otherwise fire
// (and log its 401) after this suite's `afterAll` has already torn down the
// Postgres pool, since `sendDeletionRecoveryEmail` is deliberately
// fire-and-forget (`account-lifecycle/03`).
jest.mock('../../lib/email/client.ts', () => ({
  sendEmail: jest.fn().mockResolvedValue({ ok: true }),
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
