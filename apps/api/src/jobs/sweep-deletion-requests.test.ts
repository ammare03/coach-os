import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { sweepDeletionRequests as SweepDeletionRequests } from './sweep-deletion-requests.ts';

const enqueuePurgeAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('../queues/enqueue.ts', () => ({
  enqueuePurgeAccount: (data: { userId: string }) => enqueuePurgeAccount(data),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let sweepDeletionRequests: typeof SweepDeletionRequests;

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
  ({ sweepDeletionRequests } = await import('./sweep-deletion-requests.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
});

beforeEach(() => {
  enqueuePurgeAccount.mockClear();
});

let seq = 0;
async function insertUserWithDeletionRequest(scheduledPurgeAt: Date): Promise<string> {
  seq += 1;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `sweep-${seq}-${randomUUID()}@purge-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture User',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insertUserWithDeletionRequest: users insert returned no row');
  await db.insert(schema.deletionRequests).values({ userId: user.id, scheduledPurgeAt });
  return user.id;
}

describe('sweepDeletionRequests', () => {
  it('enqueues a purge for a request past its grace period', async () => {
    const pastDue = await insertUserWithDeletionRequest(new Date(Date.now() - 60_000));

    const count = await sweepDeletionRequests(db);

    expect(count).toBeGreaterThanOrEqual(1);
    expect(enqueuePurgeAccount).toHaveBeenCalledWith({ userId: pastDue });
  });

  it('does not enqueue a request still within its grace period', async () => {
    const notYetDue = await insertUserWithDeletionRequest(new Date(Date.now() + 60_000));

    await sweepDeletionRequests(db);

    expect(enqueuePurgeAccount).not.toHaveBeenCalledWith({ userId: notYetDue });
  });

  it('is a safe no-op when nothing is due', async () => {
    // Clean slate: remove anything left pending from earlier tests in this file.
    await db.delete(schema.deletionRequests);

    const count = await sweepDeletionRequests(db);

    expect(count).toBe(0);
    expect(enqueuePurgeAccount).not.toHaveBeenCalled();
  });

  it('re-running against an already-purged user is a safe no-op', async () => {
    const userId = await insertUserWithDeletionRequest(new Date(Date.now() - 60_000));
    await sweepDeletionRequests(db);
    enqueuePurgeAccount.mockClear();

    // Simulate the purge having actually run — deletion_requests cascades
    // away with the rest of the account (identity.users ON DELETE CASCADE).
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    const count = await sweepDeletionRequests(db);

    expect(count).toBe(0);
    expect(enqueuePurgeAccount).not.toHaveBeenCalled();
  });
});
