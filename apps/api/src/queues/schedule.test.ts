// Pre-phase-09 audit: `runAgeSweep` and `sweepDeletionRequests` (both
// behaviourally well-tested in `../jobs/`) had no repeatable trigger at
// all — this is the missing coverage, that the trigger itself gets
// installed. Real Redis via Testcontainers, not a mocked ioredis, same
// reasoning as `enqueue.test.ts`: `upsertJobScheduler`'s idempotency is
// BullMQ's own behaviour against a real Redis, and a mock can't reproduce
// it. `env.ts` freezes `REDIS_URL` at module load, so the container's URL
// must be in `process.env` before `./connection.ts` (and everything that
// imports it) is ever imported — hence the dynamic `import()`s in `beforeAll`.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { queueConnection as QueueConnection } from './connection.ts';
import type {
  scheduleAgeSweep as ScheduleAgeSweep,
  scheduleDeletionRequestSweep as ScheduleDeletionRequestSweep,
} from './enqueue.ts';
import type {
  accountDeletionQueue as AccountDeletionQueue,
  ageAndModerationSweepQueue as AgeAndModerationSweepQueue,
} from './registry.ts';

let container: StartedTestContainer;
let queueConnection: typeof QueueConnection;
let accountDeletionQueue: typeof AccountDeletionQueue;
let ageAndModerationSweepQueue: typeof AgeAndModerationSweepQueue;
let scheduleAgeSweep: typeof ScheduleAgeSweep;
let scheduleDeletionRequestSweep: typeof ScheduleDeletionRequestSweep;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;

  ({ queueConnection } = await import('./connection.ts'));
  ({ accountDeletionQueue, ageAndModerationSweepQueue } = await import('./registry.ts'));
  ({ scheduleAgeSweep, scheduleDeletionRequestSweep } = await import('./enqueue.ts'));
}, 60_000);

afterAll(async () => {
  await Promise.all([accountDeletionQueue.close(), ageAndModerationSweepQueue.close()]);
  queueConnection.disconnect();
  await container.stop();
}, 60_000);

describe('scheduleAgeSweep', () => {
  it('installs a daily repeatable job on age-and-moderation-sweep', async () => {
    await scheduleAgeSweep();

    const scheduler = await ageAndModerationSweepQueue.getJobScheduler(
      'age-and-moderation-sweep-daily',
    );

    expect(scheduler?.pattern).toBe('0 2 * * *');
    expect(scheduler?.template?.data).toEqual({ kind: 'sweep' });
  });

  it('is idempotent — calling it twice installs exactly one scheduler', async () => {
    await scheduleAgeSweep();
    await scheduleAgeSweep();

    const schedulers = await ageAndModerationSweepQueue.getJobSchedulers();

    expect(schedulers.filter((s) => s.key === 'age-and-moderation-sweep-daily')).toHaveLength(1);
  });
});

describe('scheduleDeletionRequestSweep', () => {
  it('installs a daily repeatable job on account-deletion, distinct from the age sweep’s hour', async () => {
    await scheduleDeletionRequestSweep();

    const scheduler = await accountDeletionQueue.getJobScheduler('account-deletion-sweep-daily');

    expect(scheduler?.pattern).toBe('20 2 * * *');
    expect(scheduler?.template?.data).toEqual({ kind: 'sweep' });
  });

  it('is idempotent — calling it twice installs exactly one scheduler', async () => {
    await scheduleDeletionRequestSweep();
    await scheduleDeletionRequestSweep();

    const schedulers = await accountDeletionQueue.getJobSchedulers();

    expect(schedulers.filter((s) => s.key === 'account-deletion-sweep-daily')).toHaveLength(1);
  });

  it('shares the account-deletion queue with purge jobs without colliding on jobId', async () => {
    // The queue already carries `purge.{userId}`-id jobs (`enqueue.ts`);
    // the scheduler's own id namespace is separate, so installing the
    // sweep must not disturb a purge already in flight.
    const purgeJob = await accountDeletionQueue.add(
      'purge',
      { kind: 'purge', userId: 'user-schedule-test' },
      { jobId: 'purge.user-schedule-test' },
    );

    await scheduleDeletionRequestSweep();

    expect((await accountDeletionQueue.getJob('purge.user-schedule-test'))?.id).toBe(purgeJob.id);
  });
});
