import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import packageJson from '../package.json' with { type: 'json' };
import { env } from './env.ts';

// The Hono app instance is created and exported before the listener starts,
// so P02 can mount the tRPC handler onto this same instance and tests can
// drive it without opening a port.
export const app = new Hono();

// Liveness probe. P22 uses this path for deployment readiness — keep it
// stable. No tRPC, no auth, no database here; P02 owns everything else.
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: packageJson.version,
  }),
);

export const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
