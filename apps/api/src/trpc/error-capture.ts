import { logger } from '../lib/logger.ts';
import { captureServerException } from '../lib/sentry.ts';

// `02-sentry-integration.md`'s literal path is `apps/api/src/middleware/error-capture.ts`
// — not created here for the same reason `request-logging.ts` and
// `rate-limit.ts` weren't: this isn't a `.use()`-chained tRPC middleware at
// all, it's a hook `./error-formatter.ts`'s uncaught branch calls directly,
// so it lives next to the formatter it serves rather than in a new
// top-level `middleware/` folder for one file.

export interface UncaughtErrorContext {
  requestId: string | null;
  procedure: string | undefined;
  userId: string | null;
}

/**
 * The single call site for a genuinely unhandled tRPC error —
 * `./error-formatter.ts`'s branch 3 calls this instead of a bare
 * `console.error`. Two destinations, two purposes: a structured, allowlisted
 * log line (`../lib/logger.ts`) for grep-by-`requestId` across the stack,
 * and a full Sentry event — the real stack trace included — for
 * `captureServerException` to scrub down to its own context allowlist
 * before it leaves the process.
 *
 * Never called for a catalogued (`isCatalogedError`) error or a Zod
 * validation failure — `error-formatter.ts` only reaches this branch for
 * something neither of those two earlier branches recognised, which is what
 * keeps a routine `BAD_REQUEST` off CLAUDE.md §3.4.3's 5,000-events/month
 * free tier (`02-sentry-integration.md`'s Risk section).
 */
export function reportUncaughtError(error: unknown, ctx: UncaughtErrorContext): void {
  logger.error('request.uncaught_error', {
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.procedure ? { procedure: ctx.procedure } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  });

  captureServerException(error, {
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.procedure ? { procedure: ctx.procedure } : {}),
    userId: ctx.userId,
  });
}
