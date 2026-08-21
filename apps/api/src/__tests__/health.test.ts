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
