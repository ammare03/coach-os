import { Queue } from 'bullmq';

import { queueConnection } from './connection.ts';
import type {
  AiGenerationJobData,
  CheckinSchedulerJobData,
  DigestEmailJobData,
  MediaTranscodeJobData,
  NotificationsJobData,
  RetentionSweepJobData,
  WebhookProcessorJobData,
} from './types.ts';

/**
 * The seven DB§15 queues, exact string names — these appear in the
 * `bull:{queue}:*` Redis key pattern DB§15 warns never to touch by hand, so
 * getting each string exactly right here is what keeps that warning
 * meaningful (`01-bullmq-setup.md` step 2 and Risk section).
 *
 * Each queue is exported individually rather than behind a generic
 * `getQueue(name: string)` lookup, so a call site gets full payload-type
 * safety on `.add()` for free. No processor is attached to any of these —
 * that belongs to whichever phase owns the queue's purpose.
 */
export const mediaTranscodeQueue = new Queue<MediaTranscodeJobData>('media-transcode', {
  connection: queueConnection,
});

export const notificationsQueue = new Queue<NotificationsJobData>('notifications', {
  connection: queueConnection,
});

export const digestEmailQueue = new Queue<DigestEmailJobData>('digest-email', {
  connection: queueConnection,
});

export const checkinSchedulerQueue = new Queue<CheckinSchedulerJobData>('checkin-scheduler', {
  connection: queueConnection,
});

export const retentionSweepQueue = new Queue<RetentionSweepJobData>('retention-sweep', {
  connection: queueConnection,
});

export const webhookProcessorQueue = new Queue<WebhookProcessorJobData>('webhook-processor', {
  connection: queueConnection,
});

export const aiGenerationQueue = new Queue<AiGenerationJobData>('ai-generation', {
  connection: queueConnection,
});
