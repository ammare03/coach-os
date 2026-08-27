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
 * A shared function, not a standing listener of its own — no processor
 * exists yet for any of the seven queues (tasks 01–03), so there is no
 * `Worker` here to attach to. Each phase calls this once, right after
 * constructing the `Worker` it registers in `./worker.ts`'s `workers` array:
 *
 * ```ts
 * const worker = new Worker('media-transcode', processor, { connection: queueConnection });
 * attachDeadLetterHandler(worker);
 * workers.push(worker);
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
