// `platform-schema/02-audit-log.md`'s `audit_log_no_update` /
// `audit_log_no_delete` `DO INSTEAD NOTHING` rules are real Postgres RULEs
// on the migrated table, not something a mock could stand in for
// (`testing` skill §4) — real Postgres via Testcontainers, running the
// actual `migrate.ts` script (`authz.test.ts`'s own pattern), is the only
// way to verify this function's write path holds against them end to end.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { Context } from '../trpc/context.ts';

import { writeAuditLog } from './audit-log.ts';

let container: StartedTestContainer;
let db: DbClient;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

// No real user needed — `actorUserId` is nullable and every case here
// either passes `null` deliberately or exercises the FK from a fixture-free
// context, matching `writeAuditLog`'s own `ctx.user?.id ?? null` fallback.
function anonymousCtx(overrides?: Partial<Context['request']>): Pick<Context, 'user' | 'request'> {
  return {
    user: null,
    request: {
      ip: null,
      trustedIp: null,
      userAgent: null,
      receivedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    },
  };
}

describe('writeAuditLog', () => {
  it('inserts a row with the given action, target, and metadata', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, anonymousCtx(), {
        action: 'auth.login',
        targetType: 'user',
        targetId: '00000000-0000-7000-8000-000000000001',
        metadata: { method: 'password' },
      });
    });

    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000001'));

    expect(row).toMatchObject({
      action: 'auth.login',
      targetType: 'user',
      targetId: '00000000-0000-7000-8000-000000000001',
      metadata: { method: 'password' },
      actorUserId: null,
    });
  });

  it('captures ip and userAgent from context automatically, never as explicit params', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(
        tx,
        anonymousCtx({ ip: '203.0.113.7', userAgent: 'CoachOS/1.0 (iOS 26)' }),
        {
          action: 'auth.login',
          targetType: 'user',
          targetId: '00000000-0000-7000-8000-000000000002',
        },
      );
    });

    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000002'));

    expect(row?.ip).toBe('203.0.113.7');
    expect(row?.userAgent).toBe('CoachOS/1.0 (iOS 26)');
  });

  it('defaults metadata to an empty object when the caller supplies none', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, anonymousCtx(), {
        action: 'account.export',
        targetType: 'user',
        targetId: '00000000-0000-7000-8000-000000000003',
      });
    });

    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000003'));

    expect(row?.metadata).toEqual({});
  });

  it('leaves no orphaned row when the enclosing transaction rolls back', async () => {
    const rollbackSentinel = Symbol('rollback');

    await expect(
      db.transaction(async (tx) => {
        await writeAuditLog(tx, anonymousCtx(), {
          action: 'account.purge',
          targetType: 'user',
          targetId: '00000000-0000-7000-8000-0000000000ff',
        });
        throw rollbackSentinel;
      }),
    ).rejects.toBe(rollbackSentinel);

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-0000000000ff'));

    expect(rows).toHaveLength(0);
  });

  it('is append-only: a raw UPDATE against a written row silently changes nothing', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, anonymousCtx(), {
        action: 'media.delete',
        targetType: 'media_asset',
        targetId: '00000000-0000-7000-8000-000000000004',
      });
    });

    // `audit_log_no_update`'s `DO INSTEAD NOTHING` reports success and
    // changes nothing (platform.ts's own warning) — this UPDATE must not
    // throw, and the row must be provably unchanged afterward.
    await db
      .update(schema.auditLog)
      .set({ action: 'tampered.action' })
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000004'));

    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000004'));

    expect(row?.action).toBe('media.delete');
  });

  it('is append-only: a raw DELETE against a written row silently changes nothing', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, anonymousCtx(), {
        action: 'comment.delete',
        targetType: 'comment',
        targetId: '00000000-0000-7000-8000-000000000005',
      });
    });

    await db
      .delete(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000005'));

    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, '00000000-0000-7000-8000-000000000005'));

    expect(rows).toHaveLength(1);
  });
});
