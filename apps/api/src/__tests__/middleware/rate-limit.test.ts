// Real Redis via Testcontainers, not a mocked ioredis — the atomic
// INCR+EXPIRE Lua script *is* the security control
// (`02-rate-limit-middleware.md`'s own reasoning: a mock can't reproduce a
// real race). `env.ts` freezes `REDIS_URL` at module load, so the
// container's URL must be in `process.env` *before*
// `../../trpc/middleware/rate-limit.ts` (and its transitive `../../lib/redis.ts`)
// is ever imported — hence the dynamic `import()`s inside `beforeAll`,
// mirroring `context.test.ts`.
import type { DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import type { redis as Redis } from '../../lib/redis.ts';
import type { createOwnershipCache as CreateOwnershipCache } from '../../trpc/authz/ownership-cache.ts';
import type { Context, ContextUser } from '../../trpc/context.ts';
import type { router as Router, publicProcedure as PublicProcedure } from '../../trpc/init.ts';
import type { rateLimit as RateLimit, RateLimitConfig } from '../../trpc/middleware/rate-limit.ts';

let container: StartedTestContainer;
let redis: typeof Redis;
let router: typeof Router;
let publicProcedure: typeof PublicProcedure;
let rateLimit: typeof RateLimit;
let createOwnershipCache: typeof CreateOwnershipCache;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;

  ({ redis } = await import('../../lib/redis.ts'));
  ({ router, publicProcedure } = await import('../../trpc/init.ts'));
  ({ rateLimit } = await import('../../trpc/middleware/rate-limit.ts'));
  ({ createOwnershipCache } = await import('../../trpc/authz/ownership-cache.ts'));

  // `lazyConnect: true` (`../../lib/redis.ts`) means nothing has connected
  // yet — production leaves that to the first real command and lets
  // `safeRedis` fail open if it loses that race, but this suite is testing
  // real enforcement, not the fail-open path, so it needs a guaranteed-ready
  // client before its first case runs, not an incidental one.
  await redis.connect();
}, 60_000);

afterAll(async () => {
  redis.disconnect();
  await container.stop();
});

afterEach(async () => {
  // Every case below picks its own uuid-derived identity, but flushing
  // keeps failures legible instead of depending on that isolation holding.
  await redis.flushdb();
});

// The middleware never touches `ctx.db` — a proxy that records any access
// turns a silent, accidental dependency into a loud test failure instead of
// a coincidentally-passing one (`is-authed.test.ts`'s own pattern).
function createUntouchedDb(): DbClient {
  return new Proxy(() => undefined, {
    get() {
      throw new Error('rate-limit middleware must never touch ctx.db');
    },
  }) as unknown as DbClient;
}

const coachA: ContextUser = {
  id: uuidv7(),
  email: 'coach-a@rate-limit-test.com',
  role: 'coach',
  timezone: 'UTC',
  locale: 'en',
  coachProfileId: uuidv7(),
  clientProfileId: null,
  deletedAt: null,
};

function buildContext(opts: { user: ContextUser | null; trustedIp?: string | null }): Context {
  return {
    user: opts.user,
    db: createUntouchedDb(),
    redis,
    requestId: uuidv7(),
    request: {
      ip: null,
      trustedIp: opts.trustedIp ?? null,
      userAgent: null,
      receivedAt: new Date(),
    },
    ownershipCache: createOwnershipCache(),
  };
}

function buildCaller(config: RateLimitConfig, ctx: Context) {
  const scratchRouter = router({
    ping: publicProcedure.use(rateLimit(config)).query(() => ({ ok: true })),
  });
  return scratchRouter.createCaller(ctx);
}

describe('rateLimit', () => {
  it('admits exactly `max` concurrent requests for one identity, rejects the rest', async () => {
    const config: RateLimitConfig = { route: 'test.atomic', windowSeconds: 60, max: 5 };
    const ctx = buildContext({ user: coachA });
    const caller = buildCaller(config, ctx);

    const results = await Promise.allSettled(Array.from({ length: 12 }, () => caller.ping()));

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(7);
  });

  it('throws TOO_MANY_REQUESTS with a RATE_LIMITED cause and a positive retryAfterSeconds', async () => {
    const config: RateLimitConfig = { route: 'test.shape', windowSeconds: 60, max: 1 };
    const ctx = buildContext({ user: coachA });
    const caller = buildCaller(config, ctx);

    await caller.ping();

    await expect(caller.ping()).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      cause: { appCode: 'RATE_LIMITED' },
    });

    try {
      await caller.ping();
      throw new Error('expected the third call to reject');
    } catch (err) {
      const cause = (err as { cause?: { details?: { retryAfterSeconds?: number } } }).cause;
      expect(cause?.details?.retryAfterSeconds).toBeGreaterThan(0);
      expect(cause?.details?.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('keys authenticated requests by user id — two users each get their own quota', async () => {
    const config: RateLimitConfig = { route: 'test.per-user', windowSeconds: 60, max: 1 };
    const coachB: ContextUser = { ...coachA, id: uuidv7(), coachProfileId: uuidv7() };

    const callerA = buildCaller(config, buildContext({ user: coachA }));
    const callerB = buildCaller(config, buildContext({ user: coachB }));

    await expect(callerA.ping()).resolves.toEqual({ ok: true });
    await expect(callerB.ping()).resolves.toEqual({ ok: true });
    await expect(callerA.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(callerB.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('keys unauthenticated requests by the trusted client IP — two IPs each get their own quota', async () => {
    const config: RateLimitConfig = { route: 'test.per-ip', windowSeconds: 60, max: 1 };

    const callerX = buildCaller(config, buildContext({ user: null, trustedIp: '203.0.113.10' }));
    const callerY = buildCaller(config, buildContext({ user: null, trustedIp: '203.0.113.20' }));

    await expect(callerX.ping()).resolves.toEqual({ ok: true });
    await expect(callerY.ping()).resolves.toEqual({ ok: true });
    await expect(callerX.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(callerY.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('shares one bucket across unauthenticated requests with no trusted IP (e.g. local dev)', async () => {
    const config: RateLimitConfig = { route: 'test.untrusted', windowSeconds: 60, max: 1 };

    const caller1 = buildCaller(config, buildContext({ user: null, trustedIp: null }));
    const caller2 = buildCaller(config, buildContext({ user: null, trustedIp: null }));

    await expect(caller1.ping()).resolves.toEqual({ ok: true });
    // Same bucket as caller1 — a different `Context` instance, no trusted IP.
    await expect(caller2.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('resets after the window expires', async () => {
    const config: RateLimitConfig = { route: 'test.window', windowSeconds: 1, max: 1 };
    const ctx = buildContext({ user: coachA });
    const caller = buildCaller(config, ctx);

    await expect(caller.ping()).resolves.toEqual({ ok: true });
    await expect(caller.ping()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    await expect(caller.ping()).resolves.toEqual({ ok: true });
  }, 10_000);
});
