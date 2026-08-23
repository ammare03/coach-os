import { Redis, type RedisOptions } from 'ioredis';

import { env } from '../env.ts';

// No test legitimately needs "reconnect forever" — only production does.
// `jest.setup-env.ts` sets this for every test file, unconditionally, so a
// client that fails to connect (most of them: `REDIS_URL` in a test run
// points nowhere real) gives up rather than scheduling another attempt —
// otherwise a scheduled reconnect can still be in flight when whichever
// test file happened to trigger it finishes, which Jest reports as a
// leaked timer. Read once, at module load: this can never be toggled
// mid-suite by design. Never set in production.
const giveUpAfterFirstFailure = process.env.REDIS_TEST_GIVE_UP_AFTER_FIRST_FAILURE === 'true';

/**
 * Tuned for a request path, not a worker (`01-redis-connection-and-keyspace.md`
 * step 2). `../background-jobs/01-bullmq-setup.md` constructs its own client
 * from its own options and must NOT reuse this object: BullMQ requires
 * `maxRetriesPerRequest: null` and holds blocking commands (`BRPOPLPUSH`)
 * open for seconds, which would starve every rate-limit check behind a
 * queue poll if the two shared a connection. Exported only so the
 * fail-open test can build a second client against a dead port with the
 * same real-world timeouts — nothing else should construct a `Redis`
 * instance from these options.
 */
export const REQUEST_PATH_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: 2,
  connectTimeout: 2000,
  // A rate-limit check runs on every request (`02-rate-limit-middleware.md`).
  // Half a second is already ten times its budget; past it, fail open.
  commandTimeout: 500,
  // With this on, commands issued while disconnected queue in process
  // memory and resolve minutes later, long after the request they belonged
  // to has been answered — a memory leak with a delay, not a fix.
  enableOfflineQueue: false,
  // The API must boot with Redis down; readiness reports the outage
  // (`observability/04-health-and-readiness.md`), the process does not
  // crash-loop trying to connect before it can serve a single request. A
  // side effect worth naming: the very first real command anywhere in the
  // process is what *establishes* the connection, so — like every other
  // Redis failure — it can race an unfinished handshake and reject with
  // "Stream isn't writeable" (`enableOfflineQueue: false` doesn't wait for
  // one). `safeRedis` already treats that identically to any other Redis
  // outage: fail open. A caller that needs a guaranteed-ready client (e.g.
  // `rate-limit.test.ts`, which is testing real enforcement, not the
  // fail-open path) calls `.connect()` and waits for `'ready'` itself.
  lazyConnect: true,
  // Capped exponential — reconnect forever, but never faster than the
  // outage. `giveUpAfterFirstFailure` (above) is the one, test-only
  // exception.
  retryStrategy(times: number) {
    if (giveUpAfterFirstFailure) {
      return null;
    }
    return Math.min(times * 200, 10_000);
  },
};

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, REQUEST_PATH_REDIS_OPTIONS);
  // ioredis crashes the process on an unhandled 'error' event. Every
  // connection failure already surfaces through `safeRedis`'s fallback and
  // its own warning; this listener exists only to stop that crash.
  client.on('error', (err: Error) => {
    console.warn('[redis] connection error', { message: err.message });
  });
  return client;
}

/** The single request-path Redis client. Nothing else on a request path constructs its own. */
export const redis = createRedisClient(env.REDIS_URL);

// A cheap, synchronous read of the client's last-known connection state —
// `redis-safe.ts` attaches it to a fallback's warning log for context. Never
// gates whether an operation is attempted: with `lazyConnect: true` the
// first command is what *establishes* the connection, so skipping that
// command while this flag is still `false` would mean it never becomes
// `true`.
export let redisAvailable = false;
redis.on('ready', () => {
  redisAvailable = true;
});
redis.on('close', () => {
  redisAvailable = false;
});

const PING_TIMEOUT_MS = 250;

/**
 * Bounded-timeout probe for `observability/04-health-and-readiness.md`,
 * which reports Redis as *degraded* rather than *unready* — taking every
 * instance out of rotation over a cache is the outage this whole design
 * avoids. Never throws.
 */
export async function pingRedis(): Promise<'ok' | 'degraded'> {
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('redis ping timed out')), PING_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'degraded';
  }
}
