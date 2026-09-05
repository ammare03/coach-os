// `account-lifecycle/12` — `support.triggerUserExport` through the real
// router: the `operatorProcedure` gate, the pre-body audit write, and that
// the operator never appears in the subject's own export history
// afterward. `delegated.test.ts` already covers `requestExportForSubject`'s
// own logic in isolation.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { appRouter as AppRouter } from '../routers/index.ts';
import type { ContextUser } from '../trpc/context.ts';

import type { createTestContext as CreateTestContext } from './test-context.ts';

const enqueueDataExport = jest.fn().mockResolvedValue(undefined);
jest.mock('../queues/enqueue.ts', () => ({
  enqueueDataExport: (...args: unknown[]) => enqueueDataExport(...args),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let appRouter: typeof AppRouter;
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
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${crypto.randomUUID()}@support-export-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture User',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('no user row');
  return user;
}

function callerFor(user: typeof schema.users.$inferSelect) {
  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    locale: user.locale,
    coachProfileId: null,
    clientProfileId: null,
    deletedAt: null,
  };
  return appRouter.createCaller(createTestContext({ db, user: contextUser }));
}

describe('support.triggerUserExport', () => {
  it('rejects a non-operator with ROLE_REQUIRED', async () => {
    const notAnOperator = await insertUser();
    const subject = await insertUser();

    await expect(
      callerFor(notAnOperator).support.triggerUserExport({
        subjectUserId: subject.id,
        reason: 'test',
        ticketReference: 'ZD-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('succeeds for an operator and the subject never appears in the operator’s own history', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser();

    const result = await callerFor(operator).support.triggerUserExport({
      subjectUserId: subject.id,
      reason: 'Lost access, verified via ticket.',
      ticketReference: 'ZD-42',
    });
    expect(result.status).toBe('queued');

    const operatorHistory = await callerFor(operator).me.exportHistory({});
    expect(operatorHistory.items).toHaveLength(0);
  });

  it('writes a pre-body audit entry even when the call fails', async () => {
    const operator = await insertUser({ internalOperator: true });
    const subject = await insertUser();

    await callerFor(operator).support.triggerUserExport({
      subjectUserId: subject.id,
      reason: 'first',
      ticketReference: 'ZD-1',
    });

    // Second call for the same subject hits EXPORT_ALREADY_RUNNING —
    // the pre-body audit write still happens before that failure.
    await expect(
      callerFor(operator).support.triggerUserExport({
        subjectUserId: subject.id,
        reason: 'second',
        ticketReference: 'ZD-2',
      }),
    ).rejects.toMatchObject({ cause: { appCode: 'EXPORT_ALREADY_RUNNING' } });

    const attempts = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'account.export_triggered_by_operator'));
    expect(attempts.filter((row) => row.targetId === subject.id)).toHaveLength(2);
  });
});
