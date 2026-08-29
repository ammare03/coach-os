import { createDbClient } from '@coachos/db';
import { Worker } from 'bullmq';

import { env } from './env.ts';
import { buildDataExport } from './jobs/data-export.ts';
import { purgeAccount } from './jobs/purge-account.ts';
import { logger } from './lib/logger.ts';
import { initSentry } from './lib/sentry.ts';
import { queueConnection } from './queues/connection.ts';
import { registerGracefulShutdown } from './queues/graceful-shutdown.ts';
import type { AccountDeletionJobData, DataExportJobData } from './queues/types.ts';

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
 * The registration point `03-worker-process.md` built empty: as each phase
 * builds its processor, it imports its queue from `./queues/registry.ts`,
 * constructs a `new Worker(queueName, processor, { connection:
 * queueConnection })`, and pushes it here.
 */
export const workers: Worker[] = [];

// This worker process's own DB client — never the API's per-request
// `../trpc/context.ts` singleton, which is wired to Hono's request
// lifecycle this process doesn't have. One connection, reused across every
// job this process handles, same as the API's own module-scope `db`.
const db = createDbClient({
  connectionString: env.DATABASE_URL,
  sslMode: env.NODE_ENV === 'production' ? 'verify-full' : false,
});

// `account-lifecycle/04` — the first processor this worker runs.
// `'account-deletion'` must match `./queues/registry.ts`'s queue name
// exactly; BullMQ resolves a `Worker` to a queue by that string, not by
// import identity.
workers.push(
  new Worker<AccountDeletionJobData>(
    'account-deletion',
    async (job) => {
      await purgeAccount(db, job.data.userId);
    },
    { connection: queueConnection },
  ),
);

// `account-lifecycle/09`.
workers.push(
  new Worker<DataExportJobData>(
    'data-export',
    async (job) => {
      await buildDataExport(db, job.data.exportId);
    },
    { connection: queueConnection },
  ),
);

registerGracefulShutdown(workers);

logger.info('worker.started');
