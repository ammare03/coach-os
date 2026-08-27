import { checkReadiness } from './readiness.ts';

function status(value: 'ok' | 'degraded') {
  return () => Promise.resolve(value);
}

describe('checkReadiness', () => {
  it('is ok/200 when both Postgres and Redis are reachable', async () => {
    const result = await checkReadiness(status('ok'), status('ok'));
    expect(result).toEqual({ status: 'ok', db: 'ok', redis: 'ok', httpStatus: 200 });
  });

  it('is degraded/503 when Postgres is unreachable, even if Redis is fine', async () => {
    const result = await checkReadiness(status('degraded'), status('ok'));
    expect(result).toEqual({ status: 'degraded', db: 'degraded', redis: 'ok', httpStatus: 503 });
  });

  it('is degraded/503 when Redis is unreachable, even if Postgres is fine', async () => {
    const result = await checkReadiness(status('ok'), status('degraded'));
    expect(result).toEqual({ status: 'degraded', db: 'ok', redis: 'degraded', httpStatus: 503 });
  });

  it('is degraded/503 when both are unreachable', async () => {
    const result = await checkReadiness(status('degraded'), status('degraded'));
    expect(result).toEqual({
      status: 'degraded',
      db: 'degraded',
      redis: 'degraded',
      httpStatus: 503,
    });
  });

  it('checks both dependencies concurrently, not one after the other', async () => {
    const order: string[] = [];
    const slowDb = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('db');
      return 'ok' as const;
    };
    const fastRedis = async () => {
      order.push('redis');
      return 'ok' as const;
    };

    await checkReadiness(slowDb, fastRedis);

    // If these ran sequentially, `db` (the slower one) would still finish
    // first since it was started first — concurrency is what lets `redis`
    // land first despite starting second.
    expect(order).toEqual(['redis', 'db']);
  });
});
