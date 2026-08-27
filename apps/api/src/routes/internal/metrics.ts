import { schema } from '@coachos/db';
import { desc } from 'drizzle-orm';
import { Hono } from 'hono';

import { parseBearerToken } from '../../lib/bearer-token.ts';
import { isOperator } from '../../lib/is-operator.ts';
import { defaultAuthVerifier, type AuthVerifier } from '../../trpc/auth-verifier.ts';
import { db } from '../../trpc/context.ts';

/**
 * `observability/06-metrics-and-alerts.md`'s "operator-gated" read surface.
 * A plain Hono route, like `/health` and `/ready` in `../../index.ts`, not
 * a tRPC procedure — deliberately: this is the one route in the codebase
 * that skips the full request-context factory (session cache, ownership
 * memo) it doesn't need, in favour of the smallest possible code path for a
 * high-privilege check (`../../lib/is-operator.ts`'s own doc comment).
 *
 * `SUPPORT.md` SU§2 places the actual admin *UI* in `apps/web`, behind
 * Better Auth plus a second factor — not built yet
 * (`phase-26-trust-and-safety/support-tooling/`). This route is the data
 * surface that UI will call; until then, and until `phase-03-identity-and-auth`
 * ships a real `AuthVerifier`, every request here gets `UNAUTHORIZED` from
 * the same `defaultAuthVerifier` every other protected procedure does
 * (`../../trpc/auth-verifier.ts`) — not a gap specific to this route.
 *
 * `verifier` is a parameter, not a fixed import, for the same reason
 * `createContextFactory` takes one: a test needs to inject a fake one
 * without a real JWT (`../../trpc/context.ts`'s own pattern).
 */
export function createInternalMetricsRoute(verifier: AuthVerifier = defaultAuthVerifier): Hono {
  const route = new Hono();

  route.get('/', async (c) => {
    const token = parseBearerToken(c.req.header('authorization') ?? null);
    if (!token) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    const claims = await verifier(token);
    if (!claims || claims.expiresAt <= new Date()) {
      return c.json({ error: 'UNAUTHORIZED' }, 401);
    }

    if (!(await isOperator(db, claims.userId))) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }

    // Most recent sample per collection run, newest first — enough for a
    // dashboard or a support investigation without paging. `dimensions` is
    // already allowlist-safe by construction (`metrics-collector.ts`).
    const samples = await db
      .select()
      .from(schema.metricSamples)
      .orderBy(desc(schema.metricSamples.sampledAt))
      .limit(200);

    return c.json({ samples });
  });

  return route;
}

export const internalMetricsRoute = createInternalMetricsRoute();
