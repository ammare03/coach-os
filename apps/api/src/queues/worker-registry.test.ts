// Real Redis via Testcontainers and a real BullMQ `Worker` — same reasoning
// as `dead-letter.test.ts`: retry exhaustion is BullMQ's own bookkeeping
// (`job.attemptsMade` against `job.opts.attempts`) and a mock can't
// reproduce it. What this file adds over that one is the *seam*: a worker
// registered the way `../worker.ts` registers its workers must reach the
// dead-letter path without the call site doing anything else (UNFORGET S24).
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { logger } from '../lib/logger.ts';
import { captureServerException } from '../lib/sentry.ts';

import { registerWorker, workers } from './worker-registry.ts';

jest.mock('../lib/sentry.ts', () => ({ captureServerException: jest.fn() }));
jest.mock('../lib/logger.ts', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const captureServerExceptionMock = captureServerException as jest.Mock;
const loggerErrorMock = logger.error as jest.Mock;

let container: StartedTestContainer;
let connection: Redis;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  connection = new Redis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`, {
    maxRetriesPerRequest: null,
  });
}, 60_000);

afterAll(async () => {
  connection.disconnect();
  await container.stop();
}, 60_000);

it('sends a job that exhausts its retries to the dead-letter path, and adds the worker to the shutdown list', async () => {
  const queueName = `worker-registry-test-${Date.now()}`;
  const queue = new Queue(queueName, {
    connection,
    // Two attempts, 10ms apart: enough to prove the handler stays quiet
    // while a retry remains, without waiting on DB§15's real exponential
    // spacing (`registry.ts` owns that).
    defaultJobOptions: { attempts: 2, backoff: { type: 'fixed', delay: 10 } },
  });
  const worker = new Worker(
    queueName,
    () => {
      throw new Error('always fails');
    },
    { connection },
  );

  // The only wiring the call site does — no `attachDeadLetterHandler` call.
  registerWorker(worker);

  expect(workers).toContain(worker);

  // Recorded rather than asserted inside the listener: an assertion thrown
  // from BullMQ's own event emission is swallowed by its internals instead
  // of failing this test cleanly.
  const captureCallCountAtEachFailure: number[] = [];
  const finalFailure = new Promise<void>((resolve) => {
    worker.on('failed', (job) => {
      captureCallCountAtEachFailure.push(captureServerExceptionMock.mock.calls.length);
      if (job && job.attemptsMade >= 2) resolve();
    });
  });

  const enqueued = await queue.add('job', {});
  await finalFailure;

  expect(captureCallCountAtEachFailure).toEqual([0, 1]);

  // Someone hears it: a fixed-string log line carrying IDs and counts only
  // (`observability-ops` §1, §3), plus the Sentry event DB§15 requires.
  const deadLetterLogs = loggerErrorMock.mock.calls.filter(([msg]) => msg === 'job.dead_lettered');
  expect(deadLetterLogs).toHaveLength(1);
  expect(deadLetterLogs[0]?.[1]).toEqual({ jobId: enqueued.id, queue: queueName, attempt: 2 });

  const [error, context] = captureServerExceptionMock.mock.calls[0] as [
    Error,
    { jobId?: string; queue?: string },
  ];
  expect(error.message).toBe('always fails');
  expect(context).toMatchObject({ jobId: enqueued.id, queue: queueName });

  await worker.close();
  await queue.close();
}, 20_000);
