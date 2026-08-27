import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import packageJson from '../package.json' with { type: 'json' };

import { env } from './env.ts';
import { checkReadiness } from './lib/readiness.ts';
import { initSentry } from './lib/sentry.ts';
import { internalCollectRoute } from './routes/internal/collect.ts';
import { internalMetricsRoute } from './routes/internal/metrics.ts';
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
// stable. No tRPC, no auth, no database here. Deliberately checks nothing
// external (`observability/04-health-and-readiness.md`'s Risk section): an
// orchestrator restarting a healthy process over a database blip turns a
// transient outage into a cascading one. `/ready` below is the endpoint
// that answers "can this instance actually serve a request right now."
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: packageJson.version,
  }),
);

// Readiness probe — what a load balancer or deployment orchestrator checks
// before routing traffic to this instance. `checkReadiness` (`lib/readiness.ts`)
// owns the actual decision and its 250ms-per-dependency timeouts; this
// route is just the HTTP wiring.
app.get('/ready', async (c) => {
  const result = await checkReadiness();
  return c.json({ status: result.status, db: result.db, redis: result.redis }, result.httpStatus);
});

// Mounted alongside `/health` and `/ready`, not instead of them — the three
// serve different consumers (see `apps/api/src/routers/health.ts`).
app.all(`${TRPC_ENDPOINT}/*`, (c) => handleTrpcRequest(c));

// `observability/06-metrics-and-alerts.md`. Two different gates on
// purpose: `/internal/metrics` is a human, operator-gated read;
// `/internal/metrics/collect` is the scheduled trigger, gated by a shared
// secret instead (see each route's own doc comment).
app.route('/internal/metrics', internalMetricsRoute);
app.route('/internal/metrics/collect', internalCollectRoute);

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
