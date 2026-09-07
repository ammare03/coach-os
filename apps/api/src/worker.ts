import { createDbClient } from '@coachos/db';
import { Worker } from 'bullmq';

import { env } from './env.ts';
import { buildDataExport } from './jobs/data-export.ts';
import { runExerciseReconcile, runExerciseReconcileSweep } from './jobs/exercise-reconcile.ts';
import { purgeAccount } from './jobs/purge-account.ts';
import { logger } from './lib/logger.ts';
import { initSentry } from './lib/sentry.ts';
import { queueConnection } from './queues/connection.ts';
import { scheduleWeeklyExerciseReconcile } from './queues/enqueue.ts';
import { registerGracefulShutdown } from './queues/graceful-shutdown.ts';
import type {
  AccountDeletionJobData,
  DataExportJobData,
  ExerciseReconcileJobData,
} from './queues/types.ts';

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

// `exercise-library/06`. One queue, two job kinds (`./queues/types.ts`):
// the weekly `sweep` BullMQ's own scheduler emits, and the per-coach
// `reconcile` jobs it fans out into.
workers.push(
  new Worker<ExerciseReconcileJobData>(
    'exercise-reconcile',
    async (job) => {
      if (job.data.kind === 'sweep') {
        await runExerciseReconcileSweep(db);
        return;
      }
      await runExerciseReconcile(db, {
        coachId: job.data.coachId,
        isoWeek: job.data.isoWeek,
      });
    },
    { connection: queueConnection },
  ),
);

// Idempotent on the scheduler id, so re-running it on every boot is how the
// weekly trigger stays installed without a separate deploy step. A Redis
// failure here must not stop the worker from processing the queues it
// already has.
scheduleWeeklyExerciseReconcile().catch(() => {
  logger.error('worker.schedule_failed', { queue: 'exercise-reconcile' });
});

registerGracefulShutdown(workers);

logger.info('worker.started');
