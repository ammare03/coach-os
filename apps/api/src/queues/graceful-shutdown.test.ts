import type { Worker } from 'bullmq';

import { registerGracefulShutdown } from './graceful-shutdown.ts';

function fakeWorker(close: () => Promise<void>): Worker {
  return { close } as unknown as Worker;
}

describe('registerGracefulShutdown', () => {
  afterEach(() => {
    // Every case registers a fresh pair of process listeners — drop them so
    // they don't stack across tests (or fire for a later, unrelated signal).
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('exits 0 promptly when there are no workers to wait for', async () => {
    const exit = jest.fn();
    const shutdown = registerGracefulShutdown([], { exit });

    await shutdown();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('waits for every worker to close before exiting', async () => {
    const exit = jest.fn();
    // Initialised rather than declared-then-assigned so the later call needs
    // no non-null assertion — the executor runs synchronously, so this
    // holds the real `resolve` well before `resolveClose()` is reached.
    let resolveClose = () => {};
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const worker = fakeWorker(() => closePromise);

    const shutdown = registerGracefulShutdown([worker], { exit });
    const shutdownPromise = shutdown();

    // The close hasn't resolved yet — exit must not have been called.
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    resolveClose();
    await shutdownPromise;

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-exits after the timeout when a worker hangs', async () => {
    jest.useFakeTimers();
    const exit = jest.fn();
    const worker = fakeWorker(() => new Promise(() => {})); // never resolves

    const shutdown = registerGracefulShutdown([worker], { exit, timeoutMs: 1000 });
    void shutdown();

    await jest.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(1);
    jest.useRealTimers();
  });

  it('is idempotent — a second call while shutting down is a no-op', async () => {
    const exit = jest.fn();
    let resolveClose = () => {};
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const close = jest.fn(() => closePromise);
    const worker = fakeWorker(close);

    const shutdown = registerGracefulShutdown([worker], { exit });
    const first = shutdown();
    const second = shutdown();

    resolveClose();
    await Promise.all([first, second]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
