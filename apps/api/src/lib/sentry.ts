import * as Sentry from '@sentry/node';

import { env } from '../env.ts';

import { getRequestId } from './request-context.ts';

/**
 * Server-side Sentry (`observability/02-sentry-integration.md`). Distinct
 * from mobile's `@sentry/react-native` (`phase-05-app-shell/providers-and-gates/05`)
 * — same product, same free tier (CLAUDE.md §3.4.3: 5,000 events/month, one
 * user), two separate DSNs and two separate SDKs.
 *
 * `SENTRY_DSN` is optional (`../env.ts`), unlike every other required
 * variable there — the SDK's own documented behaviour is to no-op every
 * `captureException` call when `dsn` is left `undefined`, which is exactly
 * what lets local development and CI run with no Sentry account at all,
 * rather than a fail-loud startup error over an observability integration
 * that isn't load-bearing for the app to function.
 */
export function initSentry(): void {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // No performance monitoring in P02 — tracing has its own, separate
    // quota, and turning it on is a deliberate future decision, not a
    // default.
    tracesSampleRate: 0,
    // Never set a global `sampleRate` here: it would apply to every
    // captured event uniformly, including genuine unhandled exceptions —
    // `02-sentry-integration.md`'s Interfaces section is explicit that
    // those are never sampled. A future non-critical-warning capture path
    // must implement its own sampling decision before calling
    // `Sentry.captureMessage`, not lean on a global option that would
    // silently start dropping real bugs too.
    beforeSend: scrubEvent,
  });
}

/**
 * The event-context allowlist, `01-structured-logging.md`'s same
 * allowlist-not-denylist principle applied to Sentry's payload
 * (`02-sentry-integration.md`'s Interfaces section: "an unscrubbed Sentry
 * event is the same leak as an unscrubbed log line, just in a different
 * destination"). `captureServerException` below is the only place this
 * type is constructed from real request data.
 */
export interface SentryContext {
  requestId?: string;
  procedure?: string;
  userId?: string | null;
  // `04-dead-letter-handling.md`: the two tags DB§15 requires a dead-letter
  // alert to carry alongside the failure reason (which reaches Sentry via
  // `error` itself, below — never a third, free-text field here).
  jobId?: string;
  queue?: string;
}

// Rebuilt field-by-field from an explicit allowlist — never `{ ...event }`
// with a few keys deleted, which is a denylist wearing an allowlist's name
// and fails open the moment Sentry (or one of its default integrations)
// adds a new field to the event shape. `request` (headers, cookies, query
// string) and `breadcrumbs` (can carry values other integrations logged)
// have no safe subset to keep, so neither is ever copied through, not even
// partially. Exported for `sentry.test.ts` — it's the one piece of pure
// logic in this file, and the adversarial redaction case it earns is the
// same shape as `logger.test.ts`'s.
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const requestId = typeof event.tags?.requestId === 'string' ? event.tags.requestId : undefined;
  const procedure = typeof event.tags?.procedure === 'string' ? event.tags.procedure : undefined;
  const jobId = typeof event.tags?.jobId === 'string' ? event.tags.jobId : undefined;
  const queue = typeof event.tags?.queue === 'string' ? event.tags.queue : undefined;
  const userId = event.user?.id;

  return {
    // `ErrorEvent.type` is a required field whose only valid value is
    // literally `undefined` — Sentry's own discriminant between an error
    // event and every other event kind (`event.d.ts`'s doc comment).
    type: undefined,
    ...(event.event_id !== undefined ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    ...(event.level !== undefined ? { level: event.level } : {}),
    ...(event.message !== undefined ? { message: event.message } : {}),
    ...(event.exception !== undefined ? { exception: event.exception } : {}),
    ...(event.environment !== undefined ? { environment: event.environment } : {}),
    tags: {
      ...(requestId ? { requestId } : {}),
      ...(procedure ? { procedure } : {}),
      ...(jobId ? { jobId } : {}),
      ...(queue ? { queue } : {}),
    },
    ...(userId ? { user: { id: userId } } : {}),
  };
}

/**
 * The one call site every unhandled error reaches
 * (`../trpc/error-capture.ts`). Builds the scope `scrubEvent` above trusts
 * — never passes `input` (the procedure's raw arguments), which is exactly
 * where a DB§18-classified field would otherwise reach Sentry.
 */
export function captureServerException(error: unknown, context: SentryContext): void {
  // `05-request-correlation.md` step 5: a call site that already knows its
  // `requestId` (every current one does, via `ctx`) keeps it explicit — this
  // only covers a future call site with no `ctx` in hand, the same fallback
  // `logger.ts`'s `buildEntry` applies.
  const requestId = context.requestId ?? getRequestId();
  Sentry.captureException(error, (scope) => {
    if (requestId) scope.setTag('requestId', requestId);
    if (context.procedure) scope.setTag('procedure', context.procedure);
    if (context.jobId) scope.setTag('jobId', context.jobId);
    if (context.queue) scope.setTag('queue', context.queue);
    if (context.userId) scope.setUser({ id: context.userId });
    return scope;
  });
}
