// Real Redis via Testcontainers, not a mocked ioredis — deduplication *is*
// BullMQ's own `jobId` behaviour against a real Redis, and a mock can't
// reproduce it (mirrors `__tests__/middleware/rate-limit.test.ts`'s same
// reasoning). `env.ts` freezes `REDIS_URL` at module load, so the
// container's URL must be in `process.env` *before* `./connection.ts` (and
// everything that imports it) is ever imported — hence the dynamic
// `import()`s inside `beforeAll`.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { queueConnection as QueueConnection } from './connection.ts';
import type {
  enqueueAiGeneration as EnqueueAiGeneration,
  enqueueCheckinScheduler as EnqueueCheckinScheduler,
  enqueueDigestEmail as EnqueueDigestEmail,
  enqueueMediaTranscode as EnqueueMediaTranscode,
  enqueueNotification as EnqueueNotification,
  enqueueRetentionSweep as EnqueueRetentionSweep,
  enqueueWebhookProcessor as EnqueueWebhookProcessor,
} from './enqueue.ts';
import type {
  aiGenerationQueue as AiGenerationQueue,
  checkinSchedulerQueue as CheckinSchedulerQueue,
  digestEmailQueue as DigestEmailQueue,
  mediaTranscodeQueue as MediaTranscodeQueue,
  notificationsQueue as NotificationsQueue,
  retentionSweepQueue as RetentionSweepQueue,
  webhookProcessorQueue as WebhookProcessorQueue,
} from './registry.ts';

let container: StartedTestContainer;
let queueConnection: typeof QueueConnection;
let mediaTranscodeQueue: typeof MediaTranscodeQueue;
let notificationsQueue: typeof NotificationsQueue;
let digestEmailQueue: typeof DigestEmailQueue;
let checkinSchedulerQueue: typeof CheckinSchedulerQueue;
let retentionSweepQueue: typeof RetentionSweepQueue;
let webhookProcessorQueue: typeof WebhookProcessorQueue;
let aiGenerationQueue: typeof AiGenerationQueue;
let enqueueMediaTranscode: typeof EnqueueMediaTranscode;
let enqueueNotification: typeof EnqueueNotification;
let enqueueDigestEmail: typeof EnqueueDigestEmail;
let enqueueCheckinScheduler: typeof EnqueueCheckinScheduler;
let enqueueRetentionSweep: typeof EnqueueRetentionSweep;
let enqueueWebhookProcessor: typeof EnqueueWebhookProcessor;
let enqueueAiGeneration: typeof EnqueueAiGeneration;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  process.env.REDIS_URL = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;

  ({ queueConnection } = await import('./connection.ts'));
  ({
    mediaTranscodeQueue,
    notificationsQueue,
    digestEmailQueue,
    checkinSchedulerQueue,
    retentionSweepQueue,
    webhookProcessorQueue,
    aiGenerationQueue,
  } = await import('./registry.ts'));
  ({
    enqueueMediaTranscode,
    enqueueNotification,
    enqueueDigestEmail,
    enqueueCheckinScheduler,
    enqueueRetentionSweep,
    enqueueWebhookProcessor,
    enqueueAiGeneration,
  } = await import('./enqueue.ts'));
}, 60_000);

afterAll(async () => {
  await Promise.all([
    mediaTranscodeQueue.close(),
    notificationsQueue.close(),
    digestEmailQueue.close(),
    checkinSchedulerQueue.close(),
    retentionSweepQueue.close(),
    webhookProcessorQueue.close(),
    aiGenerationQueue.close(),
  ]);
  queueConnection.disconnect();
  await container.stop();
}, 60_000);

describe('idempotent enqueue — same subject twice yields one job', () => {
  it('media-transcode dedupes on assetId', async () => {
    const first = await enqueueMediaTranscode({ assetId: 'asset-1' });
    const second = await enqueueMediaTranscode({ assetId: 'asset-1' });

    expect(second.id).toBe(first.id);
    expect((await mediaTranscodeQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('notifications dedupes on notificationId', async () => {
    const first = await enqueueNotification({ notificationId: 'notif-1' });
    const second = await enqueueNotification({ notificationId: 'notif-1' });

    expect(second.id).toBe(first.id);
    expect((await notificationsQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('digest-email dedupes on coachId', async () => {
    const first = await enqueueDigestEmail({ coachId: 'coach-1' });
    const second = await enqueueDigestEmail({ coachId: 'coach-1' });

    expect(second.id).toBe(first.id);
    expect((await digestEmailQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('checkin-scheduler dedupes on checkinId', async () => {
    const first = await enqueueCheckinScheduler({ checkinId: 'checkin-1' });
    const second = await enqueueCheckinScheduler({ checkinId: 'checkin-1' });

    expect(second.id).toBe(first.id);
    expect((await checkinSchedulerQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('retention-sweep dedupes on assetId', async () => {
    const first = await enqueueRetentionSweep({ assetId: 'asset-2' });
    const second = await enqueueRetentionSweep({ assetId: 'asset-2' });

    expect(second.id).toBe(first.id);
    expect((await retentionSweepQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('webhook-processor dedupes on webhookEventId', async () => {
    const first = await enqueueWebhookProcessor({ webhookEventId: 'event-1' });
    const second = await enqueueWebhookProcessor({ webhookEventId: 'event-1' });

    expect(second.id).toBe(first.id);
    expect((await webhookProcessorQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('ai-generation dedupes on generationId', async () => {
    const first = await enqueueAiGeneration({ generationId: 'gen-1' });
    const second = await enqueueAiGeneration({ generationId: 'gen-1' });

    expect(second.id).toBe(first.id);
    expect((await aiGenerationQueue.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('a different subject on the same queue is a genuinely new job', async () => {
    const first = await enqueueMediaTranscode({ assetId: 'asset-3' });
    const second = await enqueueMediaTranscode({ assetId: 'asset-4' });

    expect(second.id).not.toBe(first.id);
  });
});

// Task 01's own verification step — confirming the registry created all
// seven queues under DB§15's exact `bull:{queue}:*` key pattern, not just
// that `enqueue.ts` compiles against them.
it('every queue appears in Redis under its own bull:{queue}:* key', async () => {
  const keys = await queueConnection.keys('bull:*');
  const queueNames = [
    'media-transcode',
    'notifications',
    'digest-email',
    'checkin-scheduler',
    'retention-sweep',
    'webhook-processor',
    'ai-generation',
  ];

  for (const name of queueNames) {
    expect(keys.some((key) => key.startsWith(`bull:${name}:`))).toBe(true);
  }
});
