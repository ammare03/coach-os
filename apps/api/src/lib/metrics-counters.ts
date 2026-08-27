import type { Redis } from 'ioredis';

import { keys } from './redis-keys.ts';
import { safeRedis } from './redis-safe.ts';

/**
 * OB§3.2's P2 signal (error rate > 25% for 5 min) has no other data source —
 * `requestLogging` writes one JSON line per request to stdout, and nothing
 * re-reads a log stream at collection time (`06-metrics-and-alerts.md` step
 * 1: "compute, don't instrument", but a rate over time still needs
 * *something* durable to sum). One minute-bucketed Redis counter per
 * outcome is the cheapest thing that is: `../jobs/metrics-collector.ts`
 * sums the last five buckets into a rate, and each bucket expires on its
 * own shortly after — no unbounded key growth, no new dependency.
 *
 * Fire-and-forget by design: a dropped increment during a Redis blip loses
 * one sample out of a 5-minute window, never a request. `safeRedis`'s
 * `undefined` fallback is exactly that — DB§15's ephemerality rule leaves
 * no legitimate case where this should risk the request that triggered it.
 */
export async function recordRequestOutcome(redis: Redis, outcome: 'ok' | 'error'): Promise<void> {
  const epochMinute = Math.floor(Date.now() / 60_000);
  const { key, ttlSeconds } = keys.requestOutcome(epochMinute, outcome);
  await safeRedis(async () => {
    await redis.incr(key);
    await redis.expire(key, ttlSeconds);
  }, undefined);
}

/**
 * Reads the last `windowMinutes` buckets (the current one included) for one
 * outcome and sums them. Missing buckets (nothing happened that minute, or
 * the key already expired) count as zero — `mget` returns `null` for those,
 * never an error.
 */
export async function sumRequestOutcome(
  redis: Redis,
  outcome: 'ok' | 'error',
  windowMinutes: number,
): Promise<number> {
  const now = Math.floor(Date.now() / 60_000);
  const minutes = Array.from({ length: windowMinutes }, (_, i) => now - i);
  const redisKeys = minutes.map((minute) => keys.requestOutcome(minute, outcome).key);

  return safeRedis(async () => {
    const values = await redis.mget(...redisKeys);
    return values.reduce((sum: number, value) => sum + (value === null ? 0 : Number(value)), 0);
  }, 0);
}
