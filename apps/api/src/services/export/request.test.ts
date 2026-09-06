// `account-lifecycle/10` — dedupe, rate limit, and the 30-day-floor
// arithmetic, against a real Postgres (`testing` skill §4). The enqueue and
// email side of `../../jobs/data-export.ts` is stubbed so this suite proves
// the request-side gate in isolation, same split
// `data-export.test.ts` already draws for the job itself.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import type { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { createTestContext as CreateTestContext } from '../../__tests__/test-context.ts';
import type { ContextUser } from '../../trpc/context.ts';

import type {
  COMPLETION_RATE_LIMIT_MS as RateLimitMs,
  requestExport as RequestExport,
} from './request.ts';

const enqueueDataExport = jest.fn().mockResolvedValue(undefined);
jest.mock('../../queues/enqueue.ts', () => ({
  enqueueDataExport: (...args: unknown[]) => enqueueDataExport(...args),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let requestExport: typeof RequestExport;
let COMPLETION_RATE_LIMIT_MS: typeof RateLimitMs;
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
  ({ requestExport, COMPLETION_RATE_LIMIT_MS } = await import('./request.ts'));
  ({ createTestContext } = await import('../../__tests__/test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

beforeEach(() => {
  enqueueDataExport.mockClear();
});

async function insertUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${crypto.randomUUID()}@request-test.com`,
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

function ctxFor(user: typeof schema.users.$inferSelect): ReturnType<typeof CreateTestContext> {
  const contextUser: ContextUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    locale: user.locale,
    isMinor: user.isMinor,
    guardianConsentAt: user.guardianConsentAt,
    coachProfileId: null,
    clientProfileId: null,
    deletedAt: null,
  };
  return createTestContext({ db, user: contextUser });
}

describe('requestExport', () => {
  it('enqueues one job and returns a queued exportId', async () => {
    const user = await insertUser();

    const result = await requestExport(db, ctxFor(user), user.id);

    expect(result.status).toBe('queued');
    expect(enqueueDataExport).toHaveBeenCalledWith({ exportId: result.exportId });

    const [row] = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.id, result.exportId));
    expect(row?.userId).toBe(user.id);
    expect(row?.requestedByUserId).toBe(user.id);
  });

  it('returns the existing in-flight request on a second call, instead of enqueuing a new one', async () => {
    const user = await insertUser();
    const first = await requestExport(db, ctxFor(user), user.id);
    enqueueDataExport.mockClear();

    await expect(requestExport(db, ctxFor(user), user.id)).rejects.toMatchObject({
      cause: {
        appCode: 'EXPORT_ALREADY_RUNNING',
        details: { exportId: first.exportId, status: 'queued' },
      },
    });
    expect(enqueueDataExport).not.toHaveBeenCalled();

    const rows = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.userId, user.id));
    expect(rows).toHaveLength(1);
  });

  it('produces exactly one row under two concurrent requests for the same user', async () => {
    const user = await insertUser();

    const results = await Promise.allSettled([
      requestExport(db, ctxFor(user), user.id),
      requestExport(db, ctxFor(user), user.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      cause: { appCode: 'EXPORT_ALREADY_RUNNING' },
    });

    const rows = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(enqueueDataExport).toHaveBeenCalledTimes(1);
  });

  it('rate-limits a second request within 24h of the last COMPLETED export, with an honest retry time', async () => {
    const user = await insertUser();
    await db.insert(schema.exportRequests).values({
      userId: user.id,
      status: 'ready',
      completedAt: new Date(Date.now() - 60_000), // completed one minute ago
    });

    await expect(requestExport(db, ctxFor(user), user.id)).rejects.toMatchObject({
      cause: { appCode: 'EXPORT_RATE_LIMITED' },
    });
    expect(enqueueDataExport).not.toHaveBeenCalled();

    try {
      await requestExport(db, ctxFor(user), user.id);
      throw new Error('expected requestExport to throw');
    } catch (err) {
      const cause = (err as TRPCError).cause as unknown as {
        details: { retryAfterSeconds: number };
      };
      // ~23h59m left, not the full 24h — proves this reads the real elapsed
      // time rather than always returning the constant.
      expect(cause.details.retryAfterSeconds).toBeGreaterThan(23 * 60 * 60);
      expect(cause.details.retryAfterSeconds).toBeLessThan(COMPLETION_RATE_LIMIT_MS / 1000);
    }
  });

  it('does not count a FAILED export against the rate limit — an immediate retry is allowed', async () => {
    const user = await insertUser();
    await db.insert(schema.exportRequests).values({
      userId: user.id,
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      completedAt: new Date(), // even if a completedAt were ever set on a failed row
    });

    const result = await requestExport(db, ctxFor(user), user.id);
    expect(result.status).toBe('queued');
    expect(enqueueDataExport).toHaveBeenCalledTimes(1);
  });

  it('is available for a suspended user — export is exempt from any suspension gate', async () => {
    const user = await insertUser({
      suspendedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const result = await requestExport(db, ctxFor(user), user.id);
    expect(result.status).toBe('queued');
  });

  it('the rate limit can never fall below the 30-day legal floor', () => {
    // One completion allowed per COMPLETION_RATE_LIMIT_MS. As long as that
    // window is <= 30 days, a user requesting once every 30 days always
    // clears it on every attempt — the arithmetic ERRORS.md ER§1.9a and
    // this task's own Approach step 3 both depend on.
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    expect(COMPLETION_RATE_LIMIT_MS).toBeLessThanOrEqual(THIRTY_DAYS_MS);
  });
});
