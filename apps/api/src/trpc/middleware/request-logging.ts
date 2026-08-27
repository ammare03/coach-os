import { getHTTPStatusCodeFromError } from '@trpc/server/http';

import { logger } from '../../lib/logger.ts';
import { recordRequestOutcome } from '../../lib/metrics-counters.ts';
import { middleware } from '../init.ts';

// Placed alongside `is-authed.ts` / `has-role.ts` / `rate-limit.ts` rather
// than `01-structured-logging.md`'s literal `apps/api/src/middleware/` path
// — `rate-limit.ts` already made this call for the identical reason: every
// other tRPC middleware in the codebase lives in `trpc/middleware/`, and a
// second top-level `middleware/` folder would split one concept across two
// locations for no reason.

/**
 * Attached in `../procedures.ts`, outermost of all of it — before
 * `databaseErrorBoundary` and `rateLimit` — so `durationMs` and `statusCode`
 * cover the whole request, including a database retry or a rate-limit
 * rejection, not just whatever ran after this middleware in the chain.
 *
 * One line per request, built from the same closed field allowlist
 * `logger.ts` enforces: `requestId`, `procedure`, `durationMs`,
 * `statusCode`, and `userId` as an opaque id — never `input` or `output`,
 * which is exactly where a DB§18-classified field would otherwise leak
 * through a generic logging middleware.
 */
export const requestLogging = middleware(async ({ ctx, next, path }) => {
  const startedAt = Date.now();
  const result = await next();
  const durationMs = Date.now() - startedAt;
  const statusCode = result.ok ? 200 : getHTTPStatusCodeFromError(result.error);

  logger.info('request.completed', {
    requestId: ctx.requestId,
    procedure: path,
    durationMs,
    statusCode,
    userId: ctx.user?.id ?? null,
    ...(ctx.user ? { role: ctx.user.role } : {}),
    ...(result.ok ? {} : { errorCode: result.error.code }),
  });

  // OB§4.3: "never alert on an individual 4xx" — a routine `BAD_REQUEST` or
  // `UNAUTHORIZED` is not the P2 signal, only a genuine 5xx is
  // (`observability/06-metrics-and-alerts.md`'s error-rate metric).
  // Awaited, not fire-and-forget: `safeRedis` already bounds it to a single
  // fast, fail-open round trip, and every other Redis write in this chain
  // (`rate-limit.ts`) is awaited the same way.
  await recordRequestOutcome(ctx.redis, statusCode >= 500 ? 'error' : 'ok');

  return result;
});
