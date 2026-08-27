interface ChainableDb {
  select: jest.Mock<ChainableDb, unknown[]>;
  from: jest.Mock<ChainableDb, unknown[]>;
  orderBy: jest.Mock<ChainableDb, unknown[]>;
  limit: jest.Mock<Promise<unknown[]>, unknown[]>;
}

function chainableDb(rows: unknown[]): ChainableDb {
  const chain: ChainableDb = {
    select: jest.fn(() => chain),
    from: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(async () => rows),
  };
  return chain;
}

describe('GET /internal/metrics', () => {
  it('returns 401 with no Authorization header', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../trpc/context.ts', () => ({ db: chainableDb([]) }));
      jest.doMock('../../lib/is-operator.ts', () => ({ isOperator: async () => true }));
      const { createInternalMetricsRoute } = await import('./metrics.ts');

      const route = createInternalMetricsRoute(async () => ({
        userId: 'user-1',
        deviceId: 'device-1',
        expiresAt: new Date(Date.now() + 60_000),
      }));

      const response = await route.request('/');
      expect(response.status).toBe(401);
    });
  });

  it('returns 401 when the verifier rejects the token', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../trpc/context.ts', () => ({ db: chainableDb([]) }));
      jest.doMock('../../lib/is-operator.ts', () => ({ isOperator: async () => true }));
      const { createInternalMetricsRoute } = await import('./metrics.ts');

      const route = createInternalMetricsRoute(async () => null);

      const response = await route.request('/', {
        headers: { authorization: 'Bearer bad-token' },
      });
      expect(response.status).toBe(401);
    });
  });

  it('returns 401 when the token has expired', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../trpc/context.ts', () => ({ db: chainableDb([]) }));
      jest.doMock('../../lib/is-operator.ts', () => ({ isOperator: async () => true }));
      const { createInternalMetricsRoute } = await import('./metrics.ts');

      const route = createInternalMetricsRoute(async () => ({
        userId: 'user-1',
        deviceId: 'device-1',
        expiresAt: new Date(Date.now() - 60_000),
      }));

      const response = await route.request('/', {
        headers: { authorization: 'Bearer expired-token' },
      });
      expect(response.status).toBe(401);
    });
  });

  it('returns 403 for an authenticated user who is not an operator', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../trpc/context.ts', () => ({ db: chainableDb([]) }));
      jest.doMock('../../lib/is-operator.ts', () => ({ isOperator: async () => false }));
      const { createInternalMetricsRoute } = await import('./metrics.ts');

      const route = createInternalMetricsRoute(async () => ({
        userId: 'user-1',
        deviceId: 'device-1',
        expiresAt: new Date(Date.now() + 60_000),
      }));

      const response = await route.request('/', {
        headers: { authorization: 'Bearer good-token' },
      });
      expect(response.status).toBe(403);
    });
  });

  it('returns the recent metric samples for a verified operator', async () => {
    await jest.isolateModulesAsync(async () => {
      const rows = [{ metric: 'service.db_reachable', value: 1 }];
      jest.doMock('../../trpc/context.ts', () => ({ db: chainableDb(rows) }));
      jest.doMock('../../lib/is-operator.ts', () => ({ isOperator: async () => true }));
      const { createInternalMetricsRoute } = await import('./metrics.ts');

      const route = createInternalMetricsRoute(async () => ({
        userId: 'operator-1',
        deviceId: 'device-1',
        expiresAt: new Date(Date.now() + 60_000),
      }));

      const response = await route.request('/', {
        headers: { authorization: 'Bearer good-token' },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ samples: rows });
    });
  });
});
