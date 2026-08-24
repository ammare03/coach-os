import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import packageJson from '../package.json' with { type: 'json' };

import { env } from './env.ts';
import { initSentry } from './lib/sentry.ts';
import { TRPC_ENDPOINT, handleTrpcRequest } from './trpc/handler.ts';

// Before anything else in the process (`02-sentry-integration.md`'s
// Approach step 1) — so a startup failure between here and the first
// request is captured too, not just request-time errors. A no-op when
// `SENTRY_DSN` is unset (`env.ts`), so this is safe to call unconditionally
// in every environment, including tests.
initSentry();

// The Hono app instance is created and exported before the listener starts,
// so tests can drive it without opening a port.
export const app = new Hono();

// Liveness probe. P22 uses this path for deployment readiness — keep it
// stable. No tRPC, no auth, no database here.
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: packageJson.version,
  }),
);

// Mounted alongside `/health`, not instead of it — the two serve different
// consumers (see `apps/api/src/routers/health.ts`).
app.all(`${TRPC_ENDPOINT}/*`, (c) => handleTrpcRequest(c));

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
