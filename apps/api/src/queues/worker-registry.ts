import type { Worker } from 'bullmq';

import { attachDeadLetterHandler } from './dead-letter.ts';

const registered: Worker[] = [];

/**
 * Every `Worker` this process runs, in registration order — read by
 * `../worker.ts`'s `registerGracefulShutdown`. Deliberately `readonly`: the
 * only way into the array is {@link registerWorker}, so a worker cannot
 * reach the shutdown list without also having a dead-letter handler.
 */
export const workers: readonly Worker[] = registered;

/**
 * The one seam every worker in this process is constructed through
 * (`../worker.ts`). Attaching `attachDeadLetterHandler` here rather than at
 * each call site is the whole point: a job that fails past its retries
 * reaches `logger.error('job.dead_lettered')` and Sentry for *every* queue,
 * including one a later phase adds without ever reading `dead-letter.ts`.
 *
 * Before this existed the handler was attached to none of the four workers,
 * so an exhausted job — including the compliance-facing age-and-moderation
 * sweep (CLAUDE.md §21.5, §21.4) — died where nobody could hear it.
 */
export function registerWorker<TData>(worker: Worker<TData>): void {
  attachDeadLetterHandler(worker);
  registered.push(worker);
}
