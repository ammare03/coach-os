import { app } from '../index.ts';
import { appRouter } from '../routers/index.ts';
import type { Context } from '../trpc/context.ts';

// Uses `createCaller`, not a running server — this is the one API test in
// the phase that doesn't need a Postgres container, so it stays a fast
// smoke test for the whole toolchain (01-trpc-server-mount.md verification).
// `health.ping` never touches `ctx.db`/`ctx.redis`, so a real connection
// isn't needed here — `context.test.ts` covers the context factory itself.
const stubContext = {
  user: null,
  requestId: 'test',
  request: { ip: null, userAgent: null, receivedAt: new Date() },
} as unknown as Context;

describe('health.ping', () => {
  it('returns status, serverTime as a Date, and version', async () => {
    const caller = appRouter.createCaller(stubContext);

    const result = await caller.health.ping();

    expect(result.status).toBe('ok');
    expect(result.serverTime).toBeInstanceOf(Date);
    expect(typeof result.version).toBe('string');
  });
});

describe('the mounted tRPC handler', () => {
  it('returns a tRPC-shaped NOT_FOUND for an unknown procedure path, not a Hono 404 page', async () => {
    const response = await app.request('/trpc/nonexistent.procedure');

    expect(response.status).toBe(404);
    // The `superjson` transformer wraps the tRPC error envelope under `.json`.
    const body = (await response.json()) as { error: { json: { data: { code: string } } } };
    expect(body.error.json.data.code).toBe('NOT_FOUND');
  });
});
