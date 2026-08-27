import { runWithRequestId } from '../../lib/request-context.ts';
import { middleware } from '../init.ts';

/**
 * Attached in `../procedures.ts`, outermost of everything — ahead of even
 * `requestLogging` — so every log line and Sentry event for the rest of the
 * request is bound to `ctx.requestId` via async-local storage, including
 * `requestLogging`'s own completion line and whatever a resolver logs deep
 * in a call stack that never received `ctx`
 * (`observability/05-request-correlation.md` step 2).
 *
 * `next()` is called synchronously inside `runWithRequestId`'s callback,
 * which is the documented pattern for keeping an async-local store alive
 * across every `await` in the continuation it starts — not just this
 * function's own synchronous frame.
 */
export const requestContext = middleware(({ ctx, next }) =>
  runWithRequestId(ctx.requestId, () => next()),
);
