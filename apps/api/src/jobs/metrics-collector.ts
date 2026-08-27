import { pingDb, schema, type DbClient } from '@coachos/db';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { sumRequestOutcome } from '../lib/metrics-counters.ts';
import type { DependencyStatus } from '../lib/readiness.ts';
import { pingRedis } from '../lib/redis.ts';

/**
 * `observability/06-metrics-and-alerts.md` step 1: "compute, don't
 * instrument" — every metric here is one SQL query, one Redis read, or one
 * existing ping, never a new counter library or time-series store. Each one
 * is OB§3's dotted name; `dimensions` never carries a user id, a name, or
 * any DB§18-classified value, only counts and identifiers a machine already
 * knows (a route name, a queue name).
 *
 * Deliberately incomplete. Several OB§3 rows have no data source anywhere
 * in this codebase yet, and this file reports what it can genuinely compute
 * rather than fabricate the rest:
 *   - Outbox permanent-failure rate, duplicate-detection rate, and
 *     `SYNC_CONFLICT` rate (OB§3.1) — sourced from the offline outbox and
 *     PostHog (`sync_failed`, ANALYTICS.md AN§3.8), neither of which exists
 *     yet (`offline-sync` skill territory).
 *   - Referential integrity pass 3 (OB§3.1) — the `exercise-reconcile`
 *     queue job (DB§15) is not built.
 *   - API p95 latency by route, transcode/dead-letter queue depth and age
 *     (OB§3.2) — no per-route latency store and no BullMQ queues exist yet
 *     (`background-jobs`, this same phase's feature 6, not started at the
 *     time this file was written).
 *   - Every OB§3.3 commitment metric (report/appeal/data-rights ages) —
 *     `coaching.reports` and the data-rights request flow are
 *     `phase-26-trust-and-safety` / `phase-03-identity-and-auth` territory.
 * When each of those lands, add its query here rather than a second
 * collector — this file is the one place OB§3 is computed.
 */
export interface CollectedMetric {
  metric: string;
  value: number;
  dimensions?: Record<string, unknown>;
}

/**
 * OB§3.1 P1 signal, and DB§14.5's "two-device bug": more than one
 * non-deleted session for the same client and program day. The DB already
 * has a partial unique index guarding the common path
 * (`sessions_client_day_unique`) — this is the belt-and-suspenders check
 * that would still catch a duplicate produced through the other
 * (`client_local_id`) idempotency path.
 */
async function countDuplicateSessions(db: DbClient): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT COUNT(*)::text AS count FROM (
      SELECT 1
      FROM ${schema.workoutSessions}
      WHERE deleted_at IS NULL AND program_day_id IS NOT NULL
      GROUP BY client_id, program_day_id, scheduled_date
      HAVING COUNT(*) > 1
    ) dupes
  `);
  return Number((row as { count: string } | undefined)?.count ?? 0);
}

/** OB§3.2: webhook processing lag, in seconds, of the oldest unprocessed event. */
async function maxWebhookLagSeconds(db: DbClient): Promise<number> {
  const [row] = await db.execute(sql`
    SELECT EXTRACT(EPOCH FROM (now() - MIN(received_at)))::text AS lag
    FROM ${schema.webhookEvents}
    WHERE processed_at IS NULL AND error IS NULL
  `);
  return Number((row as { lag: string | null } | undefined)?.lag ?? 0);
}

/**
 * `pingDbDep`/`pingRedisDep` default to the real probes, exactly like
 * `readiness.ts`'s `checkReadiness` — so `metrics-collector.test.ts` can
 * drive both the reachable and degraded case deterministically, without a
 * test needing to actually take Postgres or Redis down.
 */
export async function collectMetrics(
  db: DbClient,
  redis: Redis,
  pingDbDep: () => Promise<DependencyStatus> = () => pingDb(db),
  pingRedisDep: () => Promise<DependencyStatus> = pingRedis,
): Promise<CollectedMetric[]> {
  const [duplicateSessions, webhookLagSeconds, dbStatus, redisStatus, okCount, errorCount] =
    await Promise.all([
      countDuplicateSessions(db),
      maxWebhookLagSeconds(db),
      pingDbDep(),
      pingRedisDep(),
      sumRequestOutcome(redis, 'ok', 5),
      sumRequestOutcome(redis, 'error', 5),
    ]);

  const totalRequests = okCount + errorCount;

  return [
    { metric: 'integrity.duplicate_sessions', value: duplicateSessions },
    { metric: 'service.webhook_lag_seconds', value: webhookLagSeconds },
    { metric: 'service.db_reachable', value: dbStatus === 'ok' ? 1 : 0 },
    { metric: 'service.redis_reachable', value: redisStatus === 'ok' ? 1 : 0 },
    {
      metric: 'service.error_rate_5m',
      // A window with no traffic at all is not a 0% error rate signal worth
      // acting on — reported as 0 rather than dividing by zero.
      value: totalRequests === 0 ? 0 : errorCount / totalRequests,
      dimensions: { totalRequests },
    },
  ];
}

/**
 * Returns what it stored — `../routes/internal/collect.ts` feeds this
 * straight into `alert-evaluator.ts`'s `evaluateAlerts` rather than
 * re-running every query a second time in the same request.
 */
export async function collectAndStoreMetrics(
  db: DbClient,
  redis: Redis,
): Promise<CollectedMetric[]> {
  const metrics = await collectMetrics(db, redis);
  if (metrics.length === 0) return metrics;

  await db.insert(schema.metricSamples).values(
    metrics.map((m) => ({
      metric: m.metric,
      value: m.value,
      dimensions: m.dimensions ?? {},
    })),
  );

  return metrics;
}
