import { Redis, type RedisOptions } from 'ioredis';

import { env } from '../env.ts';

// Same test-only escape hatch `../lib/redis.ts` already established, reused
// rather than redeclared — `jest.setup-env.ts` sets this for every test
// file unconditionally. `account-lifecycle/10` is what first made this
// matter for THIS client: `me.requestExport` is the first router-level code
// to import `../queues/enqueue.ts` (previously only `jobs/*.ts` — long-lived
// worker-process code — ever did), so this is the first time a short-lived
// test process's mere act of importing `appRouter` opens a real connection
// attempt here. Without this, every such test hangs forever in any
// environment without Redis running — including CI, which provisions
// Postgres per test file via testcontainers but has never needed to
// provision Redis before now.
const giveUpAfterFirstFailure = process.env.REDIS_TEST_GIVE_UP_AFTER_FIRST_FAILURE === 'true';

/**
 * BullMQ's own Redis connection — deliberately never `../lib/redis.ts`'s
 * request-path client (`01-bullmq-setup.md` step 1, that file's own doc
 * comment). BullMQ requires `maxRetriesPerRequest: null` and holds blocking
 * commands (`BZPOPMIN` and similar) open for seconds; sharing a connection
 * tuned for a request path's millisecond budget would let a queue poll
 * starve every rate-limit check behind it.
 *
 * `lazyConnect: true` and the capped `retryStrategy` mirror `../lib/redis.ts`
 * `REQUEST_PATH_REDIS_OPTIONS` deliberately — same reasoning, applied here
 * for the first time: the API/worker process must boot (and, for this
 * client, a router must be importable) with Redis down, not crash-loop or
 * hang trying to connect before anything has actually asked it to enqueue a
 * job. Production behaviour is unchanged — nothing sets
 * `REDIS_TEST_GIVE_UP_AFTER_FIRST_FAILURE`, so `queueConnection` still
 * retries indefinitely there, exactly as before this task.
 */
export const QUEUE_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times: number) {
    if (giveUpAfterFirstFailure) {
      return null;
    }
    return Math.min(times * 200, 10_000);
  },
};

export function createQueueRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, QUEUE_REDIS_OPTIONS);
  // Same reasoning as `../lib/redis.ts`: ioredis crashes the process on an
  // unhandled 'error' event otherwise.
  client.on('error', (err: Error) => {
    console.warn('[queues] redis connection error', { message: err.message });
  });
  return client;
}

/**
 * The single connection every `Queue` (and, once `03-worker-process.md`
 * exists, every `Worker`) in this process shares. BullMQ duplicates an
 * ioredis instance internally wherever a blocking client is actually
 * needed, so passing one shared connection here — rather than one per
 * queue — is the documented, connection-frugal pattern (CLAUDE.md §3.4.2:
 * one small Redis instance for every environment in Phase 1).
 */
export const queueConnection = createQueueRedisClient();
