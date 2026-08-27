import { env } from '../env.ts';

import { logger } from './logger.ts';

/**
 * OB§4.1's fixed list. Exactly five, never a sixth
 * (`06-metrics-and-alerts.md` step 4) — the type itself is the enforcement:
 * adding a case anywhere means editing this union first, which is the one
 * place a reviewer will see it. `../jobs/alert-evaluator.ts` only ever
 * produces `'P1' | 'P2' | 'P3'` today; `P4`/`P5` exist here so this module
 * is ready the moment something can raise them.
 */
export type AlertId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

const ALERT_NAMES: Record<AlertId, string> = {
  P1: 'Data integrity',
  P2: 'API down / error storm',
  P3: 'Database unreachable',
  P4: 'Report SLA',
  P5: 'Suspected data leak',
};

/**
 * `summary` is the entire payload — step 8: "an alert body carries IDs,
 * codes, and counts. Never a user's name, never content, never a health
 * value." Every call site in this codebase builds it from numbers already
 * computed by `metrics-collector.ts`, never from a raw DB row.
 *
 * `alertId`, not `id` — this is the fixed P1–P5 literal, never a database
 * row id, and naming it `id` would both mislead a reader used to DB§11.2's
 * convention and trip the `no-hand-written-row-type` lint rule meant to
 * catch exactly that shape.
 */
export interface Alert {
  alertId: AlertId;
  summary: string;
}

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!env.ALERTS_EMAIL_TO) return;
  // Raw `fetch` against Resend's HTTP API, not the `resend` npm package —
  // CLAUDE.md §3.4.1 step 2: Node 22 already has `fetch`, and the SDK adds
  // nothing this one-shot POST needs. `RESEND_API_KEY` is already a
  // required env var (`../env.ts`) from before this task.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'CoachOS Alerts <alerts@coachos.app>',
      to: [env.ALERTS_EMAIL_TO],
      subject,
      text: body,
    }),
  });
  if (!res.ok) {
    throw new Error(`resend responded ${res.status}`);
  }
}

async function sendPush(title: string, body: string): Promise<void> {
  if (!env.ALERTS_EXPO_PUSH_TOKEN) return;
  // Same reasoning as `sendEmail`: Expo's push API is a plain REST
  // endpoint, so this skips `expo-server-sdk-node` entirely rather than add
  // a dependency for one POST (CLAUDE.md §3.4.1 step 2).
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      to: env.ALERTS_EXPO_PUSH_TOKEN,
      title,
      body,
      priority: 'high',
      sound: 'default',
    }),
  });
  if (!res.ok) {
    throw new Error(`expo push responded ${res.status}`);
  }
}

/**
 * The one call site every alert condition reaches
 * (`../jobs/alert-evaluator.ts`). Always writes the structured log line —
 * that is what makes an alert searchable by `requestId`-adjacent tooling
 * even on a day neither destination is configured (local dev, CI, or
 * before `ALERTS_EMAIL_TO`/`ALERTS_EXPO_PUSH_TOKEN` are set) — then attempts
 * both destinations, independently: a failed push must not swallow the
 * email, and vice versa.
 */
export async function dispatchAlert(alert: Alert): Promise<void> {
  const title = `[${alert.alertId}] ${ALERT_NAMES[alert.alertId]}`;

  logger.error('alert.fired', { errorCode: alert.alertId });

  const results = await Promise.allSettled([
    sendEmail(title, alert.summary),
    sendPush(title, alert.summary),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('alert.delivery_failed', { errorCode: alert.alertId });
    }
  }
}
