import type { Job, Worker } from 'bullmq';

import { logger } from '../lib/logger.ts';
import { captureServerException } from '../lib/sentry.ts';

/**
 * DB§15's alerting requirement (`04-dead-letter-handling.md`): forward to
 * Sentry only on a job's final, exhausted attempt — BullMQ fires `failed`
 * on every individual attempt failure, not just the last one, so
 * `attemptsMade >= attempts` is what distinguishes "still retrying" from
 * "genuinely dead-lettered." Forwarding on every attempt would flood
 * `observability/02`'s free tier with noise for an ordinary transient
 * failure (a momentary R2 timeout) and defeat the alert's usefulness.
 *
 * A shared function, not a standing listener of its own — it needs a
 * `Worker` to attach to. Never call it directly from `../worker.ts`:
 * `./worker-registry.ts`'s `registerWorker` is the single seam that does it
 * for every worker the process runs, so a queue added later cannot miss it.
 *
 * ```ts
 * registerWorker(new Worker('media-transcode', processor, { connection: queueConnection }));
 * ```
 */
export function attachDeadLetterHandler(worker: Worker): void {
  worker.on('failed', (job: Job | undefined, error: Error) => {
    // BullMQ can report a failure with no job context, or (per its own
    // types) a job whose id wasn't assigned — e.g. a lock lost before the
    // job could be read back. Nothing to dead-letter or tag.
    if (!job?.id) return;

    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;

    logger.error('job.dead_lettered', {
      jobId: job.id,
      queue: worker.name,
      attempt: job.attemptsMade,
    });
    captureServerException(error, {
      procedure: `queue.${worker.name}`,
      jobId: job.id,
      queue: worker.name,
    });
  });
}
