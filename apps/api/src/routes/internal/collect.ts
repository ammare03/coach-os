import { Hono } from 'hono';

import { env } from '../../env.ts';
import { evaluateAlerts } from '../../jobs/alert-evaluator.ts';
import { collectAndStoreMetrics } from '../../jobs/metrics-collector.ts';
import { logger } from '../../lib/logger.ts';
import { redis } from '../../lib/redis.ts';
import { db } from '../../trpc/context.ts';

/**
 * The "cron job" `OBSERVABILITY.md` OB§6 calls for — "a cron job that emails
 * and pushes... five alerts do not need a platform." Nothing in this repo
 * runs a scheduler in-process (no BullMQ repeatable job exists yet —
 * `background-jobs`, this same phase's feature 6, not started at the time
 * this file was written), so the schedule lives outside the process
 * entirely: `.github/workflows/metrics-cron.yml`'s free scheduled trigger
 * calls this endpoint every few minutes.
 *
 * This is machine-to-machine, not a user session — a shared secret header,
 * not `AuthVerifier`/`internal_operator` (`../../lib/is-operator.ts`'s
 * route is for a human reading the result, not for whatever wakes this one
 * up).
 */
export const internalCollectRoute = new Hono();

internalCollectRoute.post('/', async (c) => {
  const secret = c.req.header('x-internal-secret');
  if (!secret || secret !== env.INTERNAL_JOB_SECRET) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  const metrics = await collectAndStoreMetrics(db, redis);
  const dispatched = await evaluateAlerts(metrics, redis);

  logger.info('metrics.collected', { count: metrics.length });

  return c.json({ collected: metrics.length, alertsDispatched: dispatched });
});
