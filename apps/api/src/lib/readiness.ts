import { pingDb } from '@coachos/db';

import { db } from '../trpc/context.ts';

import { pingRedis } from './redis.ts';

export type DependencyStatus = 'ok' | 'degraded';

export interface ReadinessResult {
  status: DependencyStatus;
  db: DependencyStatus;
  redis: DependencyStatus;
  httpStatus: 200 | 503;
}

/**
 * The `/ready` decision (`observability/04-health-and-readiness.md`),
 * separated from the Hono route in `../index.ts` so it's testable without a
 * reachable Postgres or Redis — `readiness.test.ts` drives every
 * ok/degraded combination through injected probes; only `../index.ts`'s
 * real route ever calls this with no arguments, wiring the actual
 * bounded-timeout probes (`@coachos/db`'s `pingDb`, `./redis.ts`'s
 * `pingRedis`) in.
 *
 * `status`/`httpStatus` are `'degraded'`/`503` the moment either dependency
 * is down — CLAUDE.md §3.4's Redis-as-cache posture (DB§15: ephemeral by
 * definition) doesn't apply here the way it does to a rate-limit check
 * (`rate-limit.ts` fails open): a load balancer deciding whether to route
 * traffic is a different question from whether one request should proceed,
 * and readiness is explicitly allowed to say no.
 */
export async function checkReadiness(
  pingDbDep: () => Promise<DependencyStatus> = () => pingDb(db),
  pingRedisDep: () => Promise<DependencyStatus> = pingRedis,
): Promise<ReadinessResult> {
  const [dbStatus, redisStatus] = await Promise.all([pingDbDep(), pingRedisDep()]);
  const status: DependencyStatus = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded';

  return { status, db: dbStatus, redis: redisStatus, httpStatus: status === 'ok' ? 200 : 503 };
}
