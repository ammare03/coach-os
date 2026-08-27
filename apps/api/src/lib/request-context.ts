import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The async-local store backing request correlation
 * (`observability/05-request-correlation.md` step 2). Bound once, at the
 * outermost tRPC middleware (`../trpc/middleware/request-context.ts`), and
 * read here by `./logger.ts` and `./sentry.ts` so a log line or Sentry event
 * three functions deep in a resolver still carries the request's id without
 * `ctx` being threaded down to it.
 *
 * `requestId` only — not the whole `Context`. Widening this to carry `user`
 * or anything else would recreate exactly the "logger reaches into request
 * state directly" problem DB§18's allowlist design exists to avoid.
 */
interface RequestContextStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

// Deferred: `05-request-correlation.md`'s "carry it into jobs" step
// (`apps/api/src/queues/*` including `request_id` in every job payload, and
// the worker binding it the same way on the other side). There is no
// `apps/api/src/queues/` yet — BullMQ is wired in P02's own
// `background-jobs` feature, not built at the time this file was written.
// When that feature enqueues its first job, read `getRequestId()` at the
// enqueue call site, put it on the payload, and have the worker call
// `runWithRequestId` with it before running the job — the same pattern
// `../trpc/middleware/request-context.ts` already establishes for a
// request.
