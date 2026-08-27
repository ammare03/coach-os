// `auth-server/03` — the issued access token actually authenticates a
// later request, and device identity behaves per the flow diagram. Real
// Postgres (`testing` skill §4). `env.ts` freezes `DATABASE_URL` at module
// load, and any static import anywhere in this file that transitively
// touches it (`./test-context.ts` → `../lib/redis.ts` → `../env.ts`,
// `../routers/index.ts` → `../trpc/init.ts` → `../env.ts`, and
// `../trpc/context.ts` itself) would freeze it against `jest.setup-env.ts`'s
// fake values before `beforeAll` ever runs. Every import that could reach
// `env.ts` is therefore dynamic, inside `beforeAll`, after the container
// starts — `context.test.ts`'s own pattern, applied to every module this
// file needs rather than just one.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { verifyAccessToken as VerifyAccessToken } from '../lib/auth/access-token.ts';
import type { appRouter as AppRouter } from '../routers/index.ts';
import type { createContextFactory as CreateContextFactory } from '../trpc/context.ts';

import type { createTestContext as CreateTestContext } from './test-context.ts';

let container: StartedTestContainer;
let db: DbClient;
let createContextFactory: typeof CreateContextFactory;
let verifyAccessToken: typeof VerifyAccessToken;
let appRouter: typeof AppRouter;
let createTestContext: typeof CreateTestContext;

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

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential
  process.env.REDIS_URL = 'redis://127.0.0.1:1'; // deliberately unreachable — matches context.test.ts

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
  ({ createContextFactory } = await import('../trpc/context.ts'));
  ({ verifyAccessToken } = await import('../lib/auth/access-token.ts'));
  ({ appRouter } = await import('../routers/index.ts'));
  ({ createTestContext } = await import('./test-context.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/trpc/health.ping', { headers });
}

function signUpCaller() {
  return appRouter.createCaller(createTestContext({ db }));
}

describe('a signed-up session', () => {
  it('resolves the right ctx.user, including coachProfileId, from the issued access token', async () => {
    const session = await signUpCaller().auth.signUp({
      email: 'session-proof@session-test.com',
      password: 'a-real-password',
      name: 'Session Proof',
      timezone: 'Asia/Kolkata',
      platform: 'ios',
    });

    const createContext = createContextFactory(verifyAccessToken);
    const ctx = await createContext(
      makeRequest({ authorization: `Bearer ${session.accessToken}` }),
    );

    expect(ctx.user).toMatchObject({
      id: session.user.id,
      role: 'coach',
      timezone: 'Asia/Kolkata',
      coachProfileId: expect.any(String),
      clientProfileId: null,
    });
  });

  it('signing in twice from the same device reuses one identity.devices row and updates last_seen_at', async () => {
    const caller = signUpCaller();
    const first = await caller.auth.signUp({
      email: 'same-device@session-test.com',
      password: 'a-real-password',
      name: 'Same Device',
      timezone: 'UTC',
      platform: 'android',
    });

    const [beforeSecond] = await db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, first.deviceId));

    const second = await caller.auth.signIn({
      email: 'same-device@session-test.com',
      password: 'a-real-password',
      platform: 'android',
      deviceId: first.deviceId,
    });

    expect(second.deviceId).toBe(first.deviceId);
    const rows = await db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.userId, first.user.id));
    expect(rows).toHaveLength(1);
    if (!beforeSecond) throw new Error('seed select did not return a row');
    expect(rows[0]?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(beforeSecond.lastSeenAt.getTime());
  });

  it('ignores a deviceId belonging to another user and creates a fresh row instead', async () => {
    const caller = signUpCaller();
    const owner = await caller.auth.signUp({
      email: 'device-owner@session-test.com',
      password: 'a-real-password',
      name: 'Owner',
      timezone: 'UTC',
      platform: 'ios',
    });
    const intruder = await caller.auth.signUp({
      email: 'device-intruder@session-test.com',
      password: 'a-real-password',
      name: 'Intruder',
      timezone: 'UTC',
      platform: 'ios',
      deviceId: owner.deviceId, // someone else's device id
    });

    expect(intruder.deviceId).not.toBe(owner.deviceId);
    const [row] = await db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, intruder.deviceId));
    expect(row?.userId).toBe(intruder.user.id);
  });
});
