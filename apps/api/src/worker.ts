import type { Worker } from 'bullmq';

import { logger } from './lib/logger.ts';
import { initSentry } from './lib/sentry.ts';
// Side-effect import only — evaluating this module is what establishes the
// connection every queue and worker in this process shares
// (`./queues/connection.ts`), the same one the API process's queue registry
// produces jobs through. No processor exists yet to hold a binding to it.
import './queues/connection.ts';
import { registerGracefulShutdown } from './queues/graceful-shutdown.ts';

/**
 * The worker process entry point (`03-worker-process.md`) — genuinely
 * separate from `index.ts`, not a mode flag on it, so the API and the
 * worker can be started, stopped, and scaled independently even though
 * `CLAUDE.md` §3.4.3 expects them on one small VPS in Phase 1. Started via
 * `pnpm worker`; never imported by `index.ts` or vice versa.
 */

// Before anything else in the process, same reasoning as `index.ts`.
initSentry();

/**
 * The registration point later phases extend: as each phase builds its
 * processor, it imports its queue from `./queues/registry.ts`, constructs a
 * `new Worker(queueName, processor, { connection: queueConnection })`, and
 * pushes it here. Empty by design in this task (`03-worker-process.md`
 * step 2) — the worker starts, connects to Redis, and idles, which is
 * correct until a later phase attaches its first processor.
 */
export const workers: Worker[] = [];

registerGracefulShutdown(workers);

logger.info('worker.started');
