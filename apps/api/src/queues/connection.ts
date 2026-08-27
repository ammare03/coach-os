import { Redis, type RedisOptions } from 'ioredis';

import { env } from '../env.ts';

/**
 * BullMQ's own Redis connection — deliberately never `../lib/redis.ts`'s
 * request-path client (`01-bullmq-setup.md` step 1, that file's own doc
 * comment). BullMQ requires `maxRetriesPerRequest: null` and holds blocking
 * commands (`BZPOPMIN` and similar) open for seconds; sharing a connection
 * tuned for a request path's millisecond budget would let a queue poll
 * starve every rate-limit check behind it.
 */
export const QUEUE_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
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
