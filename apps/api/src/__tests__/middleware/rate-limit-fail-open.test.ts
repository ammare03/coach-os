// `02-rate-limit-middleware.md`'s acceptance criterion "a Redis outage does
// not block requests" — `rate-limit.test.ts` proves the middleware enforces
// a limit against a real Redis; this proves it does NOT enforce one when
// Redis is unreachable, end to end through the middleware itself rather
// than only at `safeRedis`'s own unit level (`redis-fail-open.test.ts`).
// Deliberately unreachable, not merely stopped — same address
// `context.test.ts` and `redis-fail-open.test.ts` use.
import type { DbClient } from '@coachos/db';
import { uuidv7 } from 'uuidv7';

import type { redis as Redis } from '../../lib/redis.ts';
import type { createOwnershipCache as CreateOwnershipCache } from '../../trpc/authz/ownership-cache.ts';
import type { Context, ContextUser } from '../../trpc/context.ts';
import type { router as Router, publicProcedure as PublicProcedure } from '../../trpc/init.ts';
import type { rateLimit as RateLimit, RateLimitConfig } from '../../trpc/middleware/rate-limit.ts';

let redis: typeof Redis;
let router: typeof Router;
let publicProcedure: typeof PublicProcedure;
let rateLimit: typeof RateLimit;
let createOwnershipCache: typeof CreateOwnershipCache;

beforeAll(async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:1';

  ({ redis } = await import('../../lib/redis.ts'));
  ({ router, publicProcedure } = await import('../../trpc/init.ts'));
  ({ rateLimit } = await import('../../trpc/middleware/rate-limit.ts'));
  ({ createOwnershipCache } = await import('../../trpc/authz/ownership-cache.ts'));

  // See `context.test.ts`'s `beforeAll` for why the real `retryStrategy`
  // (reconnect forever, by design) is overridden for this suite's client.
  redis.options.retryStrategy = () => null;
}, 30_000);

afterAll(() => {
  // See `context.test.ts`'s `afterAll` for why the listener is dropped
  // before disconnecting rather than after.
  redis.removeAllListeners('error');
  redis.on('error', () => {});
  redis.disconnect();
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
  email: 'coach-a@rate-limit-fail-open-test.com',
  role: 'coach',
  timezone: 'UTC',
  locale: 'en',
  isMinor: false,
  guardianConsentAt: null,
  coachProfileId: uuidv7(),
  clientProfileId: null,
  deletedAt: null,
};

function buildContext(): Context {
  return {
    user: coachA,
    db: createUntouchedDb(),
    redis,
    requestId: uuidv7(),
    request: { ip: null, trustedIp: null, userAgent: null, receivedAt: new Date() },
    ownershipCache: createOwnershipCache(),
  };
}

it('lets every request through when Redis is unreachable, even past what `max` would allow', async () => {
  const config: RateLimitConfig = { route: 'test.fail-open', windowSeconds: 60, max: 1 };
  const scratchRouter = router({
    ping: publicProcedure.use(rateLimit(config)).query(() => ({ ok: true })),
  });
  const caller = scratchRouter.createCaller(buildContext());

  // `max` is 1 — against a live Redis, calls 2 onward would reject
  // (`rate-limit.test.ts` proves that). Every one of these must still
  // succeed: the counter never got the chance to say no.
  for (let i = 0; i < 5; i += 1) {
    await expect(caller.ping()).resolves.toEqual({ ok: true });
  }
}, 15_000);
