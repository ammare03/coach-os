describe('POST /internal/metrics/collect', () => {
  it('returns 401 with no secret header', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../env.ts', () => ({ env: { INTERNAL_JOB_SECRET: 'right-secret' } }));
      const { internalCollectRoute } = await import('./collect.ts');

      const response = await internalCollectRoute.request('/', { method: 'POST' });
      expect(response.status).toBe(401);
    });
  });

  it('returns 401 with the wrong secret', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../env.ts', () => ({ env: { INTERNAL_JOB_SECRET: 'right-secret' } }));
      const { internalCollectRoute } = await import('./collect.ts');

      const response = await internalCollectRoute.request('/', {
        method: 'POST',
        headers: { 'x-internal-secret': 'wrong-secret' },
      });
      expect(response.status).toBe(401);
    });
  });

  it('collects, evaluates, and reports what fired with the right secret', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../env.ts', () => ({ env: { INTERNAL_JOB_SECRET: 'right-secret' } }));
      jest.doMock('../../trpc/context.ts', () => ({ db: {} }));
      jest.doMock('../../lib/redis.ts', () => ({ redis: {} }));
      const metrics = [{ metric: 'service.db_reachable', value: 1 }];
      jest.doMock('../../jobs/metrics-collector.ts', () => ({
        collectAndStoreMetrics: jest.fn(async () => metrics),
      }));
      jest.doMock('../../jobs/alert-evaluator.ts', () => ({
        evaluateAlerts: jest.fn(async () => ['P3']),
      }));
      const { internalCollectRoute } = await import('./collect.ts');

      const response = await internalCollectRoute.request('/', {
        method: 'POST',
        headers: { 'x-internal-secret': 'right-secret' },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        collected: 1,
        alertsDispatched: ['P3'],
      });
    });
  });
});
