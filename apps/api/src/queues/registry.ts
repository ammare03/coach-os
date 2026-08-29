import { Queue, type DefaultJobOptions } from 'bullmq';

import { queueConnection } from './connection.ts';
import type {
  AccountDeletionJobData,
  AiGenerationJobData,
  CheckinSchedulerJobData,
  DigestEmailJobData,
  MediaTranscodeJobData,
  NotificationsJobData,
  RetentionSweepJobData,
  WebhookProcessorJobData,
} from './types.ts';

/**
 * DB§15's 5-attempt policy (`04-dead-letter-handling.md` step 1), applied
 * once here rather than per-enqueue-call so no later phase can accidentally
 * under- or over-configure retry behavior for their queue. Exponential
 * backoff (5s, 10s, 20s, 40s, 80s between the five attempts) gives a
 * transient failure — a momentary R2 timeout, a webhook provider's blip —
 * real retry spacing instead of five attempts in the same second.
 *
 * `removeOnFail` is deliberately absent: DB§15 requires dead-lettered jobs
 * are **never auto-purged**, and BullMQ only removes a failed job if told
 * to. `removeOnComplete` (successful jobs) is each queue's own call once it
 * has a processor — this default only governs the failure path every queue
 * shares.
 */
const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
};

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
  defaultJobOptions,
});

export const notificationsQueue = new Queue<NotificationsJobData>('notifications', {
  connection: queueConnection,
  defaultJobOptions,
});

export const digestEmailQueue = new Queue<DigestEmailJobData>('digest-email', {
  connection: queueConnection,
  defaultJobOptions,
});

export const checkinSchedulerQueue = new Queue<CheckinSchedulerJobData>('checkin-scheduler', {
  connection: queueConnection,
  defaultJobOptions,
});

export const retentionSweepQueue = new Queue<RetentionSweepJobData>('retention-sweep', {
  connection: queueConnection,
  defaultJobOptions,
});

export const webhookProcessorQueue = new Queue<WebhookProcessorJobData>('webhook-processor', {
  connection: queueConnection,
  defaultJobOptions,
});

export const aiGenerationQueue = new Queue<AiGenerationJobData>('ai-generation', {
  connection: queueConnection,
  defaultJobOptions,
});

export const accountDeletionQueue = new Queue<AccountDeletionJobData>('account-deletion', {
  connection: queueConnection,
  defaultJobOptions,
});
