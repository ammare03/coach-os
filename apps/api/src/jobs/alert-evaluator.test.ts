import type { Redis } from 'ioredis';

import type { CollectedMetric } from './metrics-collector.ts';

function fakeRedis(): { store: Map<string, Record<string, string>>; redis: Redis } {
  const store = new Map<string, Record<string, string>>();
  const redis = {
    hgetall: jest.fn(async (key: string) => store.get(key) ?? {}),
    hset: jest.fn(async (key: string, fields: Record<string, unknown>) => {
      const existing = store.get(key) ?? {};
      store.set(key, {
        ...existing,
        ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])),
      });
      return 1;
    }),
    expire: jest.fn(async () => 1),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  } as unknown as Redis;
  return { store, redis };
}

describe('detectFiringConditions', () => {
  it('fires P1 when duplicate sessions are non-zero — OB§4.1 "any occurrence"', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [{ metric: 'integrity.duplicate_sessions', value: 1 }];
    expect(detectFiringConditions(metrics)).toEqual([expect.objectContaining({ alertId: 'P1' })]);
  });

  it('does not fire P1 when duplicate sessions is zero', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [{ metric: 'integrity.duplicate_sessions', value: 0 }];
    expect(detectFiringConditions(metrics)).toEqual([]);
  });

  it('fires P2 only above the error-rate threshold AND above the minimum traffic floor', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const lowTraffic: CollectedMetric[] = [
      { metric: 'service.error_rate_5m', value: 1, dimensions: { totalRequests: 2 } },
    ];
    expect(detectFiringConditions(lowTraffic)).toEqual([]);

    const realStorm: CollectedMetric[] = [
      { metric: 'service.error_rate_5m', value: 0.5, dimensions: { totalRequests: 100 } },
    ];
    expect(detectFiringConditions(realStorm)).toEqual([expect.objectContaining({ alertId: 'P2' })]);
  });

  it('fires P3 when the database is unreachable', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [{ metric: 'service.db_reachable', value: 0 }];
    expect(detectFiringConditions(metrics)).toEqual([expect.objectContaining({ alertId: 'P3' })]);
  });

  it('never produces P4 or P5 — this codebase has no data source for either yet', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [
      { metric: 'integrity.duplicate_sessions', value: 5 },
      { metric: 'service.error_rate_5m', value: 1, dimensions: { totalRequests: 1000 } },
      { metric: 'service.db_reachable', value: 0 },
    ];
    const ids = detectFiringConditions(metrics).map((a) => a.alertId);
    expect(ids).not.toContain('P4');
    expect(ids).not.toContain('P5');
  });
});

describe('evaluateAlerts — dedupe and escalation', () => {
  it('dispatches on first detection', async () => {
    await jest.isolateModulesAsync(async () => {
      const dispatchAlert = jest.fn(async () => undefined);
      jest.doMock('../lib/alerts.ts', () => ({ dispatchAlert }));
      const { evaluateAlerts } = await import('./alert-evaluator.ts');
      const { redis } = fakeRedis();

      const dispatched = await evaluateAlerts(
        [{ metric: 'service.db_reachable', value: 0 }],
        redis,
      );

      expect(dispatched).toEqual(['P3']);
      expect(dispatchAlert).toHaveBeenCalledTimes(1);
    });
  });

  it('does not re-dispatch on the very next evaluation while still firing', async () => {
    await jest.isolateModulesAsync(async () => {
      const dispatchAlert = jest.fn(async () => undefined);
      jest.doMock('../lib/alerts.ts', () => ({ dispatchAlert }));
      const { evaluateAlerts } = await import('./alert-evaluator.ts');
      const { redis } = fakeRedis();
      const metrics: CollectedMetric[] = [{ metric: 'service.db_reachable', value: 0 }];

      await evaluateAlerts(metrics, redis);
      const secondPass = await evaluateAlerts(metrics, redis);

      expect(secondPass).toEqual([]);
      expect(dispatchAlert).toHaveBeenCalledTimes(1);
    });
  });

  it('clears state and treats the next occurrence as new once the condition resolves', async () => {
    await jest.isolateModulesAsync(async () => {
      const dispatchAlert = jest.fn(async () => undefined);
      jest.doMock('../lib/alerts.ts', () => ({ dispatchAlert }));
      const { evaluateAlerts } = await import('./alert-evaluator.ts');
      const { redis } = fakeRedis();

      await evaluateAlerts([{ metric: 'service.db_reachable', value: 0 }], redis);
      await evaluateAlerts([{ metric: 'service.db_reachable', value: 1 }], redis); // resolved
      const thirdPass = await evaluateAlerts([{ metric: 'service.db_reachable', value: 0 }], redis); // fires again

      expect(thirdPass).toEqual(['P3']);
      expect(dispatchAlert).toHaveBeenCalledTimes(2);
    });
  });

  it('evaluates P1, P2, and P3 independently in one pass', async () => {
    await jest.isolateModulesAsync(async () => {
      const dispatchAlert = jest.fn(async () => undefined);
      jest.doMock('../lib/alerts.ts', () => ({ dispatchAlert }));
      const { evaluateAlerts } = await import('./alert-evaluator.ts');
      const { redis } = fakeRedis();

      const dispatched = await evaluateAlerts(
        [
          { metric: 'integrity.duplicate_sessions', value: 1 },
          { metric: 'service.db_reachable', value: 0 },
        ],
        redis,
      );

      expect(dispatched.sort()).toEqual(['P1', 'P3']);
    });
  });
});
