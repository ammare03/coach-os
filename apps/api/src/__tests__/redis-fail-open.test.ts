// `01-redis-connection-and-keyspace.md`'s "important one": with the client
// pointed at a dead port, `safeRedis` must return the fallback, must not
// throw, and must not hang past its bound. A test that only asserts the
// return value would pass against a client that took thirty seconds to
// give it — so this asserts elapsed time too.
import type { Redis } from 'ioredis';

import { safeRedis } from '../lib/redis-safe.ts';
import { createRedisClient } from '../lib/redis.ts';

// An address nothing listens on rather than a port that might be in local
// use — 127.0.0.1:1 is a reserved low port no Redis (or anything else)
// binds to.
const DEAD_REDIS_URL = 'redis://127.0.0.1:1';

// `connectTimeout` (2000ms) times `maxRetriesPerRequest` (2) bounds the
// worst case; this is a generous multiple of that, not a tight budget —
// the point is distinguishing "bounded" from "hangs".
const MAX_ELAPSED_MS = 8000;

describe('safeRedis against a dead connection', () => {
  let deadClient: Redis;

  beforeAll(() => {
    deadClient = createRedisClient(DEAD_REDIS_URL);
    // The real `retryStrategy` (`lib/redis.ts`) reconnects forever, by
    // design — correct in production, but it schedules a new backoff timer
    // after every failed attempt, and `afterAll`'s `disconnect()` below can
    // only cancel one that happens to be pending at that exact moment. Giving
    // up after the first attempt, for this client only, removes that race
    // instead of trying to win it (`context.test.ts` does the same).
    deadClient.options.retryStrategy = () => null;
  });

  afterAll(() => {
    // See `context.test.ts`'s `afterAll` for why the listener is dropped
    // before disconnecting rather than after.
    deadClient.removeAllListeners('error');
    deadClient.on('error', () => {});
    deadClient.disconnect();
  });

  it(
    'returns the fallback instead of throwing, within the bound',
    async () => {
      const start = Date.now();

      const result = await safeRedis(() => deadClient.get('some-key'), 'fallback-value');

      expect(result).toBe('fallback-value');
      expect(Date.now() - start).toBeLessThan(MAX_ELAPSED_MS);
    },
    MAX_ELAPSED_MS + 2000,
  );

  it(
    'never throws out of safeRedis, even for a fallback of null',
    async () => {
      await expect(safeRedis(() => deadClient.get('x'), null)).resolves.toBeNull();
    },
    MAX_ELAPSED_MS + 2000,
  );
});
