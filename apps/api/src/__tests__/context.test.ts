// Real Postgres via Testcontainers, not mocked Drizzle — `testing` skill §4.
// `env.ts` freezes `DATABASE_URL` and `REDIS_URL` at module load, so both
// must be in `process.env` *before* `../trpc/context.ts` (and its
// transitive `../env.ts` and `../lib/redis.ts` imports) is ever imported —
// hence the dynamic `import()` inside `beforeAll`, after the container
// starts. `@coachos/db` itself doesn't gate on env, so it's imported
// normally.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import type { redis as Redis } from '../lib/redis.ts';
import type {
  createContext as CreateContext,
  createContextFactory as CreateContextFactory,
} from '../trpc/context.ts';

let container: StartedTestContainer;
let createContext: typeof CreateContext;
let createContextFactory: typeof CreateContextFactory;
let redis: typeof Redis;
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

  process.env.DATABASE_URL = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  // Deliberately unreachable — 127.0.0.1:1 is a reserved low port nothing
  // binds to (matches `redis-fail-open.test.ts`). This suite's fail-open
  // assertions must not depend on whether a developer happens to have
  // `docker compose up -d`'s Redis running locally: with it up, a real
  // `redis.get()` below would resolve `null` instead of rejecting, which is
  // not what "the session-cache read fails" is testing for.
  process.env.REDIS_URL = 'redis://127.0.0.1:1';

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

  ({ createContext, createContextFactory } = await import('../trpc/context.ts'));
  ({ redis } = await import('../lib/redis.ts'));
  db = (await createContext(makeRequest())).db;
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  // No `redis.disconnect()` here — `REDIS_TEST_GIVE_UP_AFTER_FIRST_FAILURE`
  // (`jest.setup-env.ts`) means the singleton already gave up permanently
  // after its one failed attempt against the unreachable address above,
  // long before this runs: no pending reconnect timer, nothing to tear
  // down. Dropping the listener is the one thing still worth doing — the
  // client can emit a final stray `'error'` on its own even from a fully
  // idle, already-`'end'` state, and this stops it from logging through a
  // `console.warn` Jest has already torn down for this file.
  redis.removeAllListeners('error');
  redis.on('error', () => {});
  await container.stop();
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/trpc/health.ping', { headers });
}

describe('createContext', () => {
  it('resolves user: null with no authorization header, and does not throw', async () => {
    const ctx = await createContext(makeRequest());
    expect(ctx.user).toBeNull();
  });

  it('resolves user: null with a malformed authorization header, and does not throw', async () => {
    const ctx = await createContext(makeRequest({ authorization: 'garbage xyz' }));
    expect(ctx.user).toBeNull();
  });

  it('resolves user: null when the verifier rejects the token', async () => {
    const ctxFactory = createContextFactory(() => null);
    const ctx = await ctxFactory(makeRequest({ authorization: 'Bearer whatever' }));
    expect(ctx.user).toBeNull();
  });

  it('resolves user: null when the token has already expired', async () => {
    const ctxFactory = createContextFactory(() => ({
      userId: uuidv7(),
      deviceId: uuidv7(),
      expiresAt: new Date(Date.now() - 1000),
    }));
    const ctx = await ctxFactory(makeRequest({ authorization: 'Bearer whatever' }));
    expect(ctx.user).toBeNull();
  });

  it('resolves user: null when the token is valid but the user is soft-deleted', async () => {
    const [inserted] = await db
      .insert(schema.users)
      .values({
        email: 'deleted@ctx-test.com',
        passwordHash: 'x',
        name: 'Gone',
        role: 'coach',
        deletedAt: new Date(),
      })
      .returning({ id: schema.users.id });
    if (!inserted) throw new Error('seed insert did not return a row');

    const ctxFactory = createContextFactory(() => ({
      userId: inserted.id,
      deviceId: uuidv7(),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const ctx = await ctxFactory(makeRequest({ authorization: 'Bearer whatever' }));
    expect(ctx.user).toBeNull();
  });

  it("resolves a live coach's user with their coachProfileId, no clientProfileId, and timezone from the row", async () => {
    const [coachUser] = await db
      .insert(schema.users)
      .values({
        email: 'coach@ctx-test.com',
        passwordHash: 'x',
        name: 'Coach',
        role: 'coach',
        timezone: 'Asia/Kolkata',
      })
      .returning({ id: schema.users.id });
    if (!coachUser) throw new Error('seed insert into users did not return a row');
    const [coachProfile] = await db
      .insert(schema.coachProfiles)
      .values({ userId: coachUser.id })
      .returning({ id: schema.coachProfiles.id });
    if (!coachProfile) throw new Error('seed insert into coach_profiles did not return a row');

    const ctxFactory = createContextFactory(() => ({
      userId: coachUser.id,
      deviceId: uuidv7(),
      expiresAt: new Date(Date.now() + 60_000),
    }));
    const ctx = await ctxFactory(makeRequest({ authorization: 'Bearer whatever' }));

    expect(ctx.user).toMatchObject({
      id: coachUser.id,
      coachProfileId: coachProfile.id,
      clientProfileId: null,
      timezone: 'Asia/Kolkata',
    });
  });

  it('adopts a well-formed inbound x-request-id and generates one otherwise', async () => {
    const inbound = uuidv7();
    const withInbound = await createContext(makeRequest({ 'x-request-id': inbound }));
    expect(withInbound.requestId).toBe(inbound);

    const withMalformed = await createContext(makeRequest({ 'x-request-id': 'not-a-uuid' }));
    expect(withMalformed.requestId).not.toBe('not-a-uuid');

    const withNone = await createContext(makeRequest());
    expect(withNone.requestId).toBeTruthy();
  });

  it('reuses the same db and redis instances across concurrent requests', async () => {
    const [a, b] = await Promise.all([createContext(makeRequest()), createContext(makeRequest())]);
    expect(a.db).toBe(b.db);
    expect(a.redis).toBe(b.redis);
  });

  it('still resolves a live user from Postgres when the Redis session-cache read fails', async () => {
    // `REDIS_URL` points at an unreachable address for this whole suite
    // (see `beforeAll`); the "live coach" test above already proves the
    // fall-through works, since it could not otherwise succeed.
    const ctx = await createContext(makeRequest());
    await expect(ctx.redis.get('anything')).rejects.toThrow();
  });
});
