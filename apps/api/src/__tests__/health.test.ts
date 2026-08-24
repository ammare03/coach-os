import packageJson from '../../package.json' with { type: 'json' };
import { app } from '../index.ts';

describe('GET /health', () => {
  it('reports ok with the running package version', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      version: packageJson.version,
    });
  });
});

describe('GET /ready', () => {
  // `../lib/readiness.ts`'s `checkReadiness` is mocked here rather than
  // hit for real (`readiness.test.ts` already covers its decision logic
  // exhaustively) — a route-level test asserting real Postgres/Redis
  // reachability would pass or fail based on whether this machine happens
  // to have both running, which is exactly the flakiness `04-health-and-readiness.md`'s
  // own Verification section works around by stopping/restarting Postgres
  // deliberately rather than relying on ambient state. `isolateModulesAsync`
  // (the same pattern `../lib/logger.test.ts` uses for its production-env
  // case) gives each case a fresh `app` built against its own mock.
  it('returns 200 with status ok when both dependencies are reachable', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../lib/readiness.ts', () => ({
        checkReadiness: async () => ({ status: 'ok', db: 'ok', redis: 'ok', httpStatus: 200 }),
      }));
      const { app: isolatedApp } = await import('../index.ts');

      const response = await isolatedApp.request('/ready');

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok', db: 'ok', redis: 'ok' });
    });
  });

  it('returns 503 with status degraded when a dependency is unreachable', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../lib/readiness.ts', () => ({
        checkReadiness: async () => ({
          status: 'degraded',
          db: 'degraded',
          redis: 'ok',
          httpStatus: 503,
        }),
      }));
      const { app: isolatedApp } = await import('../index.ts');

      const response = await isolatedApp.request('/ready');

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: 'degraded',
        db: 'degraded',
        redis: 'ok',
      });
    });
  });
});
