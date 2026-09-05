// Real Redis via Testcontainers and a real BullMQ Worker — the 5-attempt
// exhaustion check depends on BullMQ's own retry bookkeeping
// (`job.attemptsMade`), which a mock can't reproduce (mirrors
// `enqueue.test.ts`'s same reasoning). This queue/worker pair is its own,
// independent of `./registry.ts` and `../env.ts` — `attachDeadLetterHandler`
// only needs a `Worker`, so there's no reason to route through the frozen
// `REDIS_URL` singleton other suites depend on import order for.
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { captureServerException } from '../lib/sentry.ts';

import { attachDeadLetterHandler } from './dead-letter.ts';

jest.mock('../lib/sentry.ts', () => ({ captureServerException: jest.fn() }));

const captureServerExceptionMock = captureServerException as jest.Mock;

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

afterEach(() => {
  captureServerExceptionMock.mockClear();
});

it('forwards to Sentry exactly once, only after the 5th (final) failed attempt', async () => {
  const queueName = `dead-letter-test-${Date.now()}`;
  const queue = new Queue(queueName, {
    connection,
    // Fixed 10ms backoff — this test cares about the attempt count and
    // the one-alert behaviour, not DB§15's real spacing (`registry.ts`
    // owns that); a fast backoff keeps the case well under a second.
    defaultJobOptions: { attempts: 5, backoff: { type: 'fixed', delay: 10 } },
  });
  const worker = new Worker(
    queueName,
    () => {
      throw new Error('always fails');
    },
    { connection },
  );
  attachDeadLetterHandler(worker);

  // Recorded rather than asserted inside the listener — an assertion
  // failure thrown from inside BullMQ's own event emission would be
  // swallowed by its internals rather than failing this test cleanly.
  const captureCallCountAtEachFailure: number[] = [];
  const finalFailure = new Promise<void>((resolve) => {
    worker.on('failed', (job) => {
      captureCallCountAtEachFailure.push(captureServerExceptionMock.mock.calls.length);
      if (job && job.attemptsMade >= 5) resolve();
    });
  });

  const enqueued = await queue.add('job', {});
  await finalFailure;

  // Not called on attempts 1–4 (still retrying), called exactly once on
  // the 5th (dead-lettered).
  expect(captureCallCountAtEachFailure).toEqual([0, 0, 0, 0, 1]);

  const [error, context] = captureServerExceptionMock.mock.calls[0] as [
    Error,
    { jobId?: string; queue?: string },
  ];
  expect(error.message).toBe('always fails');
  expect(context).toMatchObject({ jobId: enqueued.id, queue: queueName });

  // DB§15: dead-lettered, never auto-purged.
  const counts = await queue.getJobCounts('failed');
  expect(counts.failed).toBe(1);

  await worker.close();
  await queue.close();
}, 20_000);
