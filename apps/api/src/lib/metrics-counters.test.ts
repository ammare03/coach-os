import type { Redis } from 'ioredis';

import { recordRequestOutcome, sumRequestOutcome } from './metrics-counters.ts';

function fakeRedis(): { store: Map<string, string>; redis: Redis } {
  const store = new Map<string, string>();
  const redis = {
    incr: jest.fn(async (key: string) => {
      const next = String(Number(store.get(key) ?? '0') + 1);
      store.set(key, next);
      return Number(next);
    }),
    expire: jest.fn(async () => 1),
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
  } as unknown as Redis;
  return { store, redis };
}

describe('recordRequestOutcome / sumRequestOutcome', () => {
  it('increments the current minute bucket for the given outcome', async () => {
    const { redis } = fakeRedis();
    await recordRequestOutcome(redis, 'ok');
    await recordRequestOutcome(redis, 'ok');
    await recordRequestOutcome(redis, 'error');

    expect(await sumRequestOutcome(redis, 'ok', 5)).toBe(2);
    expect(await sumRequestOutcome(redis, 'error', 5)).toBe(1);
  });

  it('never mixes ok and error counts', async () => {
    const { redis } = fakeRedis();
    await recordRequestOutcome(redis, 'error');

    expect(await sumRequestOutcome(redis, 'ok', 5)).toBe(0);
  });

  it('treats a missing bucket as zero, never throwing', async () => {
    const { redis } = fakeRedis();
    await expect(sumRequestOutcome(redis, 'ok', 5)).resolves.toBe(0);
  });

  it('fails open (returns without throwing) when Redis itself errors', async () => {
    const redis = {
      incr: jest.fn(async () => {
        throw new Error('connection reset');
      }),
      expire: jest.fn(),
      mget: jest.fn(async () => {
        throw new Error('connection reset');
      }),
    } as unknown as Redis;

    await expect(recordRequestOutcome(redis, 'ok')).resolves.toBeUndefined();
    await expect(sumRequestOutcome(redis, 'ok', 5)).resolves.toBe(0);
  });
});
