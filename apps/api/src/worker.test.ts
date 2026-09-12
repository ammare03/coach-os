// The recurrence guard for UNFORGET S24: `worker.ts` ran four BullMQ
// workers with no dead-letter handler on any of them, so a job that failed
// past its retries died where nobody could hear it. This test enumerates the
// workers the file actually constructs — it never counts them — so a fifth
// worker added later without going through `registerWorker` fails CI rather
// than silently reopening the gap.
//
// `bullmq` is faked here rather than run against a real Redis: the subject is
// the wiring `worker.ts` performs at import time, and the dead-letter
// behaviour itself is proved against a real broker in
// `./queues/worker-registry.test.ts`.

interface MockWorkerInstance {
  name: string;
}

const mockConstructedWorkers: MockWorkerInstance[] = [];

jest.mock('bullmq', () => {
  class MockWorker {
    constructor(
      public name: string,
      public processor: unknown,
      public opts: unknown,
    ) {
      mockConstructedWorkers.push(this);
    }
    on(): this {
      return this;
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  class MockQueue {
    constructor(public name: string) {}
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { Worker: MockWorker, Queue: MockQueue };
});

// Nothing real to connect to, and nothing here needs one.
jest.mock('./queues/connection.ts', () => ({ queueConnection: {} }));
jest.mock('./queues/enqueue.ts', () => ({
  scheduleAgeSweep: jest.fn().mockResolvedValue(undefined),
  scheduleDeletionRequestSweep: jest.fn().mockResolvedValue(undefined),
  scheduleWeeklyExerciseReconcile: jest.fn().mockResolvedValue(undefined),
}));
// Would otherwise install SIGTERM/SIGINT handlers on the Jest process.
jest.mock('./queues/graceful-shutdown.ts', () => ({ registerGracefulShutdown: jest.fn() }));
jest.mock('./queues/dead-letter.ts', () => ({ attachDeadLetterHandler: jest.fn() }));
jest.mock('./lib/sentry.ts', () => ({ initSentry: jest.fn(), captureServerException: jest.fn() }));
jest.mock('./lib/logger.ts', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

it('routes every worker it constructs through registerWorker, so each one is dead-lettered', async () => {
  const { attachDeadLetterHandler } = await import('./queues/dead-letter.ts');
  await import('./worker.ts');
  const { workers } = await import('./queues/worker-registry.ts');

  // Guards against the test passing vacuously if the mock ever stops
  // intercepting construction.
  expect(mockConstructedWorkers.length).toBeGreaterThan(0);

  const attached = (attachDeadLetterHandler as jest.Mock).mock.calls.map(
    ([worker]) => worker as MockWorkerInstance,
  );

  // Queue names first: a mismatch names the worker that was missed.
  const constructedNames = mockConstructedWorkers.map((worker) => worker.name);
  expect(attached.map((worker) => worker.name)).toEqual(constructedNames);
  expect(workers.map((worker) => worker.name)).toEqual(constructedNames);

  // Then identity — the same instances, not merely same-named ones.
  mockConstructedWorkers.forEach((worker, index) => {
    expect(attached[index]).toBe(worker);
    expect(workers[index]).toBe(worker);
  });
});
