import { getHTTPStatusCodeFromError } from '@trpc/server/http';

import { logger } from '../../lib/logger.ts';
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

  logger.info('request.completed', {
    requestId: ctx.requestId,
    procedure: path,
    durationMs,
    statusCode: result.ok ? 200 : getHTTPStatusCodeFromError(result.error),
    userId: ctx.user?.id ?? null,
    ...(ctx.user ? { role: ctx.user.role } : {}),
    ...(result.ok ? {} : { errorCode: result.error.code }),
  });

  return result;
});
