import type { Redis } from 'ioredis';

import { dispatchAlert, type Alert, type AlertId } from '../lib/alerts.ts';
import { keys } from '../lib/redis-keys.ts';
import { safeRedis } from '../lib/redis-safe.ts';

import type { CollectedMetric } from './metrics-collector.ts';

const ESCALATION_INTERVAL_MS = 15 * 60_000;

// P2's threshold: OB§4.1 says "error rate > 25% for 5 min". The 5-minute
// window is already baked into `sumRequestOutcome`'s call in
// `metrics-collector.ts` (`service.error_rate_5m`) — this file only checks
// the threshold on the latest sample.
const ERROR_RATE_THRESHOLD = 0.25;
// Below this many requests in the window, a "25%" reading is one or two
// unlucky calls, not a storm (OB§4.3: never alert on an individual error).
const MIN_REQUESTS_FOR_ERROR_RATE = 20;

function findMetric(metrics: CollectedMetric[], name: string): CollectedMetric | undefined {
  return metrics.find((m) => m.metric === name);
}

/**
 * The three conditions this codebase can actually observe today, mapped
 * from `metrics-collector.ts`'s output to OB§4.1's alert ids. Returns the
 * subset currently firing — dedupe/escalation is applied after this by
 * `evaluateAlerts`, not here, so this function stays a pure, easily-tested
 * mapping from numbers to a verdict.
 *
 * P4 (report SLA) and P5 (suspected data leak) are declared in `AlertId`
 * but never produced here: P4 needs `coaching.reports`
 * (`phase-26-trust-and-safety`, not built), and P5 is explicitly a
 * human-filed report, not a polled metric — OB§4.1's own wording is "any
 * **report** of a user seeing another user's data". `alerts.ts`'s
 * `dispatchAlert` is ready for whichever future caller (the trust-and-safety
 * reporting flow) raises P5 directly; this evaluator has nothing to poll
 * for it.
 */
export function detectFiringConditions(metrics: CollectedMetric[]): Alert[] {
  const firing: Alert[] = [];

  const duplicateSessions = findMetric(metrics, 'integrity.duplicate_sessions');
  if (duplicateSessions && duplicateSessions.value > 0) {
    firing.push({
      alertId: 'P1',
      summary: `${duplicateSessions.value} duplicate workout session(s) detected for the same client and program day.`,
    });
  }

  const errorRate = findMetric(metrics, 'service.error_rate_5m');
  const totalRequests = Number(errorRate?.dimensions?.totalRequests ?? 0);
  if (
    errorRate &&
    totalRequests >= MIN_REQUESTS_FOR_ERROR_RATE &&
    errorRate.value > ERROR_RATE_THRESHOLD
  ) {
    firing.push({
      alertId: 'P2',
      summary: `API error rate is ${(errorRate.value * 100).toFixed(1)}% over the last 5 minutes (${totalRequests} requests).`,
    });
  }

  const dbReachable = findMetric(metrics, 'service.db_reachable');
  if (dbReachable && dbReachable.value === 0) {
    firing.push({ alertId: 'P3', summary: 'The database is unreachable.' });
  }

  return firing;
}

interface AlertState {
  stage: number;
  lastFiredAt: number;
}

async function readAlertState(redis: Redis, alertId: AlertId): Promise<AlertState | null> {
  const { key } = keys.alertState(alertId);
  return safeRedis(async () => {
    const raw = await redis.hgetall(key);
    if (!raw.stage || !raw.lastFiredAt) return null;
    return { stage: Number(raw.stage), lastFiredAt: Number(raw.lastFiredAt) };
  }, null);
}

async function writeAlertState(redis: Redis, alertId: AlertId, state: AlertState): Promise<void> {
  const { key, ttlSeconds } = keys.alertState(alertId);
  await safeRedis(async () => {
    await redis.hset(key, { stage: state.stage, lastFiredAt: state.lastFiredAt });
    await redis.expire(key, ttlSeconds);
  }, undefined);
}

async function clearAlertState(redis: Redis, alertId: AlertId): Promise<void> {
  const { key } = keys.alertState(alertId);
  await safeRedis(async () => {
    await redis.del(key);
  }, undefined);
}

/**
 * OB§4's dedupe/escalation rule: "a firing condition alerts once, then
 * again at an escalation interval — never every evaluation cycle"
 * (`06-metrics-and-alerts.md` step 5). Runs after `detectFiringConditions`:
 * a condition still firing only re-dispatches once
 * `ESCALATION_INTERVAL_MS` has passed since it last actually sent; a
 * condition that stops firing clears its state so the next occurrence is
 * treated as new, not a continuation.
 */
export async function evaluateAlerts(metrics: CollectedMetric[], redis: Redis): Promise<AlertId[]> {
  const firing = detectFiringConditions(metrics);
  const firingIds = new Set(firing.map((a) => a.alertId));
  const dispatched: AlertId[] = [];

  for (const alertId of ['P1', 'P2', 'P3'] as const) {
    if (!firingIds.has(alertId)) {
      await clearAlertState(redis, alertId);
      continue;
    }

    const alert = firing.find((a) => a.alertId === alertId);
    if (!alert) continue;

    const state = await readAlertState(redis, alertId);
    const now = Date.now();
    const shouldDispatch = !state || now - state.lastFiredAt >= ESCALATION_INTERVAL_MS;

    if (shouldDispatch) {
      await dispatchAlert(alert);
      await writeAlertState(redis, alertId, {
        stage: (state?.stage ?? 0) + 1,
        lastFiredAt: now,
      });
      dispatched.push(alertId);
    }
  }

  return dispatched;
}
