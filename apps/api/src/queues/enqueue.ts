import {
  accountDeletionQueue,
  aiGenerationQueue,
  checkinSchedulerQueue,
  dataExportQueue,
  digestEmailQueue,
  exerciseReconcileQueue,
  mediaTranscodeQueue,
  notificationsQueue,
  retentionSweepQueue,
  webhookProcessorQueue,
} from './registry.ts';

/**
 * The idempotent job contract (`02-idempotent-job-contract.md`, DB§15):
 * every job carries a `jobId` derived deterministically from its subject,
 * so re-enqueueing the same subject is safe — BullMQ treats `.add()` with
 * an already-queued `jobId` as a no-op. One wrapper function per queue,
 * each requiring the subject id and deriving `jobId` internally, is what
 * makes this structural rather than a convention a call site could forget:
 * **no code path in `apps/api` may call a queue's raw `.add()`.**
 *
 * **Delimiter is `.`, not `:`.** DB§15's own example writes the convention
 * as `transcode:{assetId}`; BullMQ 6 rejects that literally — it reserves a
 * colon-separated custom `jobId` for its own repeatable-job id format and
 * throws `Custom Id cannot contain :` for anything that doesn't split into
 * exactly three `:`-separated parts (`job.js`'s `validateOptions`,
 * discovered by `enqueue.test.ts` against a real Redis before this
 * comment existed). `.` carries the same "queue-subject : id" readability
 * DB§15 intended without hitting that reservation — DB§15 has been
 * corrected to match.
 *
 * Deduplication only holds while the earlier job with that `jobId` is still
 * pending/active — BullMQ frees the id once a job completes or fails
 * terminally, so a later, genuinely new job for the same subject (e.g. a
 * second transcode after the asset was re-uploaded) is not blocked
 * forever.
 *
 * Each derivation convention is documented at its call site below; a
 * future change to a payload (adding a second field) must not change what
 * the id is derived from, or deduplication silently breaks for that queue.
 */

/** `jobId`: `transcode.{assetId}` — one transcode in flight per asset at a time. */
export function enqueueMediaTranscode(data: { assetId: string }) {
  return mediaTranscodeQueue.add('transcode', data, { jobId: `transcode.${data.assetId}` });
}

/** `jobId`: `notification.{notificationId}` — one delivery attempt in flight per notification. */
export function enqueueNotification(data: { notificationId: string }) {
  return notificationsQueue.add('notification', data, {
    jobId: `notification.${data.notificationId}`,
  });
}

/** `jobId`: `digest.{coachId}` — one digest email in flight per coach. */
export function enqueueDigestEmail(data: { coachId: string }) {
  return digestEmailQueue.add('digest', data, { jobId: `digest.${data.coachId}` });
}

/** `jobId`: `checkin.{checkinId}` — one reminder in flight per scheduled check-in. */
export function enqueueCheckinScheduler(data: { checkinId: string }) {
  return checkinSchedulerQueue.add('checkin', data, { jobId: `checkin.${data.checkinId}` });
}

/** `jobId`: `retention.{assetId}` — one sweep in flight per asset. */
export function enqueueRetentionSweep(data: { assetId: string }) {
  return retentionSweepQueue.add('retention', data, { jobId: `retention.${data.assetId}` });
}

/** `jobId`: `webhook.{webhookEventId}` — mirrors `platform.webhook_events`' own `UNIQUE (provider, event_id)`. */
export function enqueueWebhookProcessor(data: { webhookEventId: string }) {
  return webhookProcessorQueue.add('webhook', data, {
    jobId: `webhook.${data.webhookEventId}`,
  });
}

/** `jobId`: `ai-generation.{generationId}` — one generation in flight per request. */
export function enqueueAiGeneration(data: { generationId: string }) {
  return aiGenerationQueue.add('ai-generation', data, {
    jobId: `ai-generation.${data.generationId}`,
  });
}

/**
 * `jobId`: `purge.{userId}` — at most one purge of a given account in
 * flight at a time (`account-lifecycle/04`). `sweep-deletion-requests.ts`
 * re-enqueues the same subject on every sweep run until the account is
 * actually gone; BullMQ's own dedup is what makes that safe rather than
 * queuing a second purge on top of one still running.
 */
export function enqueuePurgeAccount(data: { userId: string }) {
  return accountDeletionQueue.add('purge', data, { jobId: `purge.${data.userId}` });
}

/**
 * `jobId`: `export.{exportId}` — one build in flight per export request
 * (`account-lifecycle/09`). DB§15's own prose writes the example as
 * `export:{exportId}`; corrected to `.` here for the same reason every
 * other derivation in this file already is — `.`, not `:`, per this
 * comment block's own note above.
 */
export function enqueueDataExport(data: { exportId: string }) {
  return dataExportQueue.add('export', data, { jobId: `export.${data.exportId}` });
}

/** The BullMQ job-scheduler id behind the weekly fan-out. One, forever. */
const EXERCISE_RECONCILE_SCHEDULER_ID = 'exercise-reconcile-weekly';

/**
 * Monday 03:00 in the server's timezone — off-peak by design
 * (`exercise-library/06` Approach step 1). A coach opening the app on a
 * Monday morning sees last week's digest already waiting rather than
 * competing with their own dashboard queries for the database.
 */
const EXERCISE_RECONCILE_CRON = '0 3 * * 1';

/**
 * Installs the weekly repeatable trigger for `exercise-reconcile`.
 * `upsertJobScheduler` is idempotent on the scheduler id, so calling this on
 * every worker boot is safe and is how the schedule stays in Redis without a
 * separate deploy step. The emitted job carries `{ kind: 'sweep' }`;
 * `../jobs/exercise-reconcile.ts` fans it out into one
 * {@link enqueueExerciseReconcile} per coach.
 */
export function scheduleWeeklyExerciseReconcile() {
  return exerciseReconcileQueue.upsertJobScheduler(
    EXERCISE_RECONCILE_SCHEDULER_ID,
    { pattern: EXERCISE_RECONCILE_CRON },
    { name: 'sweep', data: { kind: 'sweep' } },
  );
}

/** `exercise-library/06`'s literal job id. See {@link enqueueExerciseReconcile}. */
export function exerciseReconcileJobId(coachId: string, isoWeek: string): string {
  return `exercise-reconcile:${coachId}:${isoWeek}`;
}

/**
 * `jobId`: `exercise-reconcile:{coachId}:{isoWeek}` — one reconciliation
 * per coach per ISO week, which is the whole of this job's idempotency
 * contract at the queue level (`exercise-library/06` Approach step 1).
 *
 * **The one `:`-delimited id in this file, and deliberately so.** The block
 * at the top of this module explains why every other derivation uses `.`:
 * BullMQ rejects a custom `jobId` containing `:` *unless* it splits into
 * exactly three parts, which is the shape it reserves for its own
 * repeatable-job ids (`job.js`'s `validateOptions`). This id has exactly
 * three parts, so it is accepted verbatim as the task specifies it — and
 * `enqueue.test.ts` asserts that against a real Redis rather than trusting
 * the reading of that source.
 *
 * Queue-level dedup only holds while the earlier job is pending or active,
 * so it is not on its own enough to guarantee "two runs in one week produce
 * one digest" — `../jobs/exercise-reconcile.ts` re-checks for an existing
 * digest row before writing one. Both layers, because either alone leaves a
 * window.
 */
export function enqueueExerciseReconcile(data: { coachId: string; isoWeek: string }) {
  return exerciseReconcileQueue.add(
    'reconcile',
    { kind: 'reconcile', coachId: data.coachId, isoWeek: data.isoWeek },
    { jobId: exerciseReconcileJobId(data.coachId, data.isoWeek) },
  );
}
