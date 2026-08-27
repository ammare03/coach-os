import type { Worker } from 'bullmq';

import { logger } from '../lib/logger.ts';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

export interface GracefulShutdownOptions {
  /** Bounded wait for in-flight jobs before force-exiting. */
  timeoutMs?: number;
  /** Injectable for `graceful-shutdown.test.ts` — real code never overrides this. */
  exit?: (code: number) => void;
}

/**
 * SIGTERM/SIGINT handling (`03-worker-process.md`). `Worker.close()` already
 * waits for an active job to finish before resolving — this wraps that in a
 * bounded timeout so a genuinely stuck job (a hung R2 upload, a wedged
 * ffmpeg process) can't hang the process forever, and guards against a
 * signal arriving twice (an orchestrator sending SIGTERM then SIGKILL-timing
 * out and retrying) triggering a second, overlapping shutdown.
 *
 * `workers` is read at signal time, not captured by value — `worker.ts`'s
 * registration point (an array later phases push their `Worker` into as
 * they attach processors) can keep growing after this call.
 *
 * Returns the shutdown function itself so a test can invoke it directly
 * with injected workers and an `exit` spy, rather than sending a real OS
 * signal to the Jest process.
 */
export function registerGracefulShutdown(
  workers: Worker[],
  {
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    exit = process.exit.bind(process),
  }: GracefulShutdownOptions = {},
): () => Promise<void> {
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('worker.shutdown.start');

    const forceExit = setTimeout(() => {
      logger.error('worker.shutdown.timeout');
      exit(1);
    }, timeoutMs);
    // Never itself the reason the process stays alive — only the pending
    // `Worker.close()` calls below should do that.
    forceExit.unref();

    try {
      await Promise.all(workers.map((worker) => worker.close()));
      clearTimeout(forceExit);
      logger.info('worker.shutdown.complete');
      exit(0);
    } catch {
      clearTimeout(forceExit);
      logger.error('worker.shutdown.error');
      exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return shutdown;
}
