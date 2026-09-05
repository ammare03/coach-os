// `account-lifecycle/10`/`11` — `me.exportStatus`/`exportDownloadUrl`'s
// ownership boundary and the download-url mint, through the real router
// (`testing` skill §4: every procedure test includes its auth-failure
// path). `data-export.test.ts`/`request.test.ts` already cover the job
// and the request gate in isolation; this file is the router-level glue
// those two don't touch.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { appRouter as AppRouter } from '../routers/index.ts';
import type { ContextUser } from '../trpc/context.ts';

import type { createTestContext as CreateTestContext } from './test-context.ts';

const getSignedDownloadUrl = jest.fn().mockResolvedValue('https://example.com/signed-download');
jest.mock('../lib/storage/r2-client.ts', () => ({
  getSignedDownloadUrl: (...args: unknown[]) => getSignedDownloadUrl(...args),
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
      email: `${crypto.randomUUID()}@me-export-test.com`,
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

async function insertMinor(guardianEmail: string) {
  return insertUser({ isMinor: true, guardianEmail, guardianConsentAt: new Date() });
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

describe('me.exportStatus / me.exportDownloadUrl', () => {
  it("NOT_FOUND, never FORBIDDEN, for another user's exportId", async () => {
    const owner = await insertUser();
    const other = await insertUser();
    const [row] = await db
      .insert(schema.exportRequests)
      .values({ userId: owner.id, status: 'ready' })
      .returning();
    if (!row) throw new Error('no export_requests row');

    await expect(callerFor(other).me.exportStatus({ exportId: row.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(callerFor(other).me.exportDownloadUrl({ exportId: row.id })).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      },
    );
  });

  it('returns a signed URL for the owner of a ready export', async () => {
    const owner = await insertUser();
    const [row] = await db
      .insert(schema.exportRequests)
      .values({ userId: owner.id, status: 'ready', objectKey: `exports/${owner.id}/x.zip` })
      .returning();
    if (!row) throw new Error('no export_requests row');

    const result = await callerFor(owner).me.exportDownloadUrl({ exportId: row.id });
    expect(result.downloadUrl).toBe('https://example.com/signed-download');
    expect(getSignedDownloadUrl).toHaveBeenCalledWith(row.objectKey, 3600);
  });

  it('returns null, not an error, for an export that is not ready yet', async () => {
    const owner = await insertUser();
    const [row] = await db
      .insert(schema.exportRequests)
      .values({ userId: owner.id, status: 'building' })
      .returning();
    if (!row) throw new Error('no export_requests row');

    const result = await callerFor(owner).me.exportDownloadUrl({ exportId: row.id });
    expect(result.downloadUrl).toBeNull();
  });

  it('exportStatus reports 100% progress once ready, 0% while queued', async () => {
    const owner = await insertUser();
    const [ready] = await db
      .insert(schema.exportRequests)
      .values({ userId: owner.id, status: 'ready' })
      .returning();
    const [queued] = await db
      .insert(schema.exportRequests)
      .values({ userId: owner.id, status: 'queued' })
      .returning();
    if (!ready || !queued) throw new Error('no export_requests row');

    const caller = callerFor(owner);
    await expect(caller.me.exportStatus({ exportId: ready.id })).resolves.toMatchObject({
      progressPercent: 100,
    });
    await expect(caller.me.exportStatus({ exportId: queued.id })).resolves.toMatchObject({
      progressPercent: 0,
    });
  });
});

describe('account-lifecycle/12 — guardian access to a dependent’s export', () => {
  it('lets a confirmed guardian poll, download, and see a dependent’s export in history', async () => {
    const guardian = await insertUser();
    const minor = await insertMinor(guardian.email);
    const [row] = await db
      .insert(schema.exportRequests)
      .values({
        userId: minor.id,
        requestedByUserId: guardian.id,
        status: 'ready',
        objectKey: `exports/${minor.id}/x.zip`,
      })
      .returning();
    if (!row) throw new Error('no export_requests row');

    const caller = callerFor(guardian);
    await expect(caller.me.exportStatus({ exportId: row.id })).resolves.toMatchObject({
      progressPercent: 100,
    });
    const download = await caller.me.exportDownloadUrl({ exportId: row.id });
    expect(download.downloadUrl).toBe('https://example.com/signed-download');

    const history = await caller.me.exportHistory({});
    expect(history.items.map((item) => item.id)).toContain(row.id);
  });

  it('never lets an unrelated caller reach a dependent’s export, even if they also requested one that day', async () => {
    const guardian = await insertUser();
    const minor = await insertMinor(guardian.email);
    const stranger = await insertUser();
    const [row] = await db
      .insert(schema.exportRequests)
      .values({ userId: minor.id, requestedByUserId: guardian.id, status: 'ready' })
      .returning();
    if (!row) throw new Error('no export_requests row');

    await expect(callerFor(stranger).me.exportStatus({ exportId: row.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const strangerHistory = await callerFor(stranger).me.exportHistory({});
    expect(strangerHistory.items.map((item) => item.id)).not.toContain(row.id);
  });

  it('loses guardian access the moment is_minor clears, even for an export it already requested', async () => {
    const guardian = await insertUser();
    const formerMinor = await insertUser({
      isMinor: false,
      guardianEmail: guardian.email,
      guardianConsentAt: new Date(),
    });
    const [row] = await db
      .insert(schema.exportRequests)
      .values({ userId: formerMinor.id, requestedByUserId: guardian.id, status: 'ready' })
      .returning();
    if (!row) throw new Error('no export_requests row');

    await expect(callerFor(guardian).me.exportStatus({ exportId: row.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
