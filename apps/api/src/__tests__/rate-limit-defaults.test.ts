// Real Redis via Testcontainers — `03-per-route-config-and-429-handling.md`'s
// two structural guarantees: (1) a procedure nobody configured still gets
// CLAUDE.md §6.5's 600/min default automatically, keyed to its own path, and
// (2) the dedicated `auth.*` throttle shares one bucket across its whole
// group without contending with any other procedure's own bucket — the bug
// a bare per-IP key (rather than a per-route one) would reintroduce.
// `env.ts` freezes `REDIS_URL` at module load, so the container's URL must
// land in `process.env` before `../trpc/procedures.ts` (and its transitive
// `../lib/redis.ts`) is ever imported — hence the dynamic `import()`s,
// mirroring `middleware/rate-limit.test.ts`.
import type { DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { uuidv7 } from 'uuidv7';

import type { redis as Redis } from '../lib/redis.ts';
import type { createOwnershipCache as CreateOwnershipCache } from '../trpc/authz/ownership-cache.ts';
import type { Context, ContextUser } from '../trpc/context.ts';
import type { router as Router } from '../trpc/init.ts';
import type {
  authProcedure as AuthProcedure,
  publicProcedure as PublicProcedure,
} from '../trpc/procedures.ts';

let container: StartedTestContainer;
let redis: typeof Redis;
let router: typeof Router;
let publicProcedure: typeof PublicProcedure;
let authProcedure: typeof AuthProcedure;
let createOwnershipCache: typeof CreateOwnershipCache;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;

  ({ redis } = await import('../lib/redis.ts'));
  ({ router } = await import('../trpc/init.ts'));
  ({ publicProcedure, authProcedure } = await import('../trpc/procedures.ts'));
  ({ createOwnershipCache } = await import('../trpc/authz/ownership-cache.ts'));

  // See `middleware/rate-limit.test.ts`'s `beforeAll` — `lazyConnect: true`
  // means nothing has connected yet, and this suite needs a guaranteed-ready
  // client before its first case, not an incidental one.
  await redis.connect();
}, 60_000);

afterAll(async () => {
  redis.disconnect();
  await container.stop();
}, 60_000);

afterEach(async () => {
  await redis.flushdb();
});

function createUntouchedDb(): DbClient {
  return new Proxy(() => undefined, {
    get() {
      throw new Error('rate-limit middleware must never touch ctx.db');
    },
  }) as unknown as DbClient;
}

const coachA: ContextUser = {
  id: uuidv7(),
  email: 'coach-a@rate-limit-defaults-test.com',
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

describe('the structural default tier', () => {
  it('applies automatically to a procedure with no explicit rate-limit config', async () => {
    const scratchRouter = router({
      unconfigured: publicProcedure.query(() => ({ ok: true })),
    });
    const caller = scratchRouter.createCaller(buildContext({ user: coachA }));

    // 600/min (`rate-limit-config.ts`) — 601 concurrent calls must admit
    // exactly 600 and reject the rest, with no `.use(rateLimit(...))`
    // anywhere on this procedure.
    const results = await Promise.allSettled(
      Array.from({ length: 601 }, () => caller.unconfigured()),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(succeeded).toHaveLength(600);
    expect(rejected).toHaveLength(1);
  }, 30_000);

  it("keys two different unconfigured procedures by their own path — one's traffic never counts against the other's", async () => {
    const scratchRouter = router({
      first: publicProcedure.query(() => ({ ok: true })),
      second: publicProcedure.query(() => ({ ok: true })),
    });
    const caller = scratchRouter.createCaller(buildContext({ user: coachA }));

    // Exhaust `first`'s bucket entirely...
    await Promise.allSettled(Array.from({ length: 601 }, () => caller.first()));
    // ...`second` must be completely unaffected.
    await expect(caller.second()).resolves.toEqual({ ok: true });
  }, 30_000);
});

describe('the dedicated auth.* throttle', () => {
  it('shares one bucket across every procedure built on authProcedure', async () => {
    const scratchRouter = router({
      signIn: authProcedure.query(() => ({ ok: true })),
      signUp: authProcedure.query(() => ({ ok: true })),
    });
    const caller = scratchRouter.createCaller(
      buildContext({ user: null, trustedIp: '198.51.100.7' }),
    );

    // 10/15min shared (`rate-limit-config.ts`) — 5 to signIn, 5 to signUp
    // exhausts the *shared* bucket; the 11th call, to either procedure,
    // must reject.
    for (let i = 0; i < 5; i += 1) {
      await expect(caller.signIn()).resolves.toEqual({ ok: true });
    }
    for (let i = 0; i < 5; i += 1) {
      await expect(caller.signUp()).resolves.toEqual({ ok: true });
    }
    await expect(caller.signIn()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await expect(caller.signUp()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it("never contends with an unrelated unauthenticated procedure's own default bucket, even from the same IP", async () => {
    const scratchRouter = router({
      signIn: authProcedure.query(() => ({ ok: true })),
      unrelated: publicProcedure.query(() => ({ ok: true })),
    });
    const ip = '198.51.100.9';
    const caller = scratchRouter.createCaller(buildContext({ user: null, trustedIp: ip }));

    await caller.signIn();
    await caller.unrelated();

    // Two distinct keys, not one shared by both — `rl:auth:{ip}` (the
    // dedicated throttle) and `rl:unrelated:{ip}` (the structural default,
    // keyed by this procedure's own tRPC path), per `redis-keys.ts`.
    const allKeys = await redis.keys('*rl:*');
    const authKeys = allKeys.filter((k) => k.includes('rl:auth:'));
    const unrelatedKeys = allKeys.filter((k) => k.includes('rl:unrelated:'));
    expect(authKeys).toHaveLength(1);
    expect(unrelatedKeys).toHaveLength(1);
    expect(authKeys[0]).not.toBe(unrelatedKeys[0]);
  });
});
