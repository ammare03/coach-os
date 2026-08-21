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

// Guarded so importing this module under test (to get `app`) never opens a
// real port — Jest would otherwise leave every test file with an open
// handle. `env.ts`'s NODE_ENV enum has carried a 'test' value since it was
// written for exactly this check (quality-gates/01).
export const server =
  env.NODE_ENV === 'test'
    ? undefined
    : serve({ fetch: app.fetch, port: env.PORT }, (info) => {
        console.log(`API listening on http://localhost:${info.port}`);
      });
