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

  it('fires P1 when orphaned exercise references are non-zero (OB§3.1 pass 3, S23)', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [
      {
        metric: 'integrity.orphaned_exercise_refs',
        value: 2,
        dimensions: { setLogs: 2, personalRecords: 0 },
      },
    ];
    const firing = detectFiringConditions(metrics);
    expect(firing).toEqual([
      expect.objectContaining({
        alertId: 'P1',
        summary: expect.stringContaining('training.exercises'),
      }),
    ]);
  });

  it('does not fire P1 when orphaned exercise references is zero', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [
      {
        metric: 'integrity.orphaned_exercise_refs',
        value: 0,
        dimensions: { setLogs: 0, personalRecords: 0 },
      },
    ];
    expect(detectFiringConditions(metrics)).toEqual([]);
  });

  // `evaluateAlerts` dispatches at most one alert per alert id per cycle, so
  // two integrity metrics firing as two separate P1 objects would silently
  // drop one of the two summaries. OB§4.1's P1 is "any integrity metric
  // non-zero" — one alert, every reason named.
  it('folds every firing integrity metric into ONE P1 that names both', async () => {
    const { detectFiringConditions } = await import('./alert-evaluator.ts');
    const metrics: CollectedMetric[] = [
      { metric: 'integrity.duplicate_sessions', value: 3 },
      {
        metric: 'integrity.orphaned_exercise_refs',
        value: 1,
        dimensions: { setLogs: 1, personalRecords: 0 },
      },
    ];
    const firing = detectFiringConditions(metrics);
    expect(firing).toHaveLength(1);
    expect(firing[0]?.alertId).toBe('P1');
    expect(firing[0]?.summary).toContain('duplicate workout session');
    expect(firing[0]?.summary).toContain('training.exercises');
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

  // S23's second half. Pass 3 used to call `dispatchAlert` directly from
  // `services/exercises/reconcile.ts`, once per coach-run — in a genuinely
  // broken week that is one page per coach, which is how alerting dies
  // (`observability-ops` §7). Routing the orphan count through the metric
  // makes it share the one dedupe every other condition already uses.
  it('dedupes the orphan P1 across evaluations, exactly like every other condition', async () => {
    await jest.isolateModulesAsync(async () => {
      const dispatchAlert = jest.fn(async () => undefined);
      jest.doMock('../lib/alerts.ts', () => ({ dispatchAlert }));
      const { evaluateAlerts } = await import('./alert-evaluator.ts');
      const { redis } = fakeRedis();

      const orphans: CollectedMetric[] = [
        {
          metric: 'integrity.orphaned_exercise_refs',
          value: 4,
          dimensions: { setLogs: 3, personalRecords: 1 },
        },
      ];

      expect(await evaluateAlerts(orphans, redis)).toEqual(['P1']);
      expect(await evaluateAlerts(orphans, redis)).toEqual([]);
      expect(await evaluateAlerts(orphans, redis)).toEqual([]);
      expect(dispatchAlert).toHaveBeenCalledTimes(1);
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
