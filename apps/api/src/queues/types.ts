/**
 * One payload interface per DB§15 queue. Each is deliberately minimal — a
 * single subject id, the thing `enqueue.ts`'s `jobId` convention derives
 * from — for the owning phase to extend rather than redefine from scratch
 * (`01-bullmq-setup.md` step 3). No processor reads these yet; this task
 * builds infrastructure, not behavior.
 */

/** `phase-11-media-pipeline/transcode-worker/`. */
export interface MediaTranscodeJobData {
  assetId: string;
}

/** `phase-15-notifications`. */
export interface NotificationsJobData {
  notificationId: string;
}

/** `phase-15-notifications` (weekly/monthly digest, one job per coach). */
export interface DigestEmailJobData {
  coachId: string;
}

/** `phase-17-structured-checkins/checkin-scheduler/`. */
export interface CheckinSchedulerJobData {
  checkinId: string;
}

/** Retention sweep for one media asset past its tier's retention window (DB§16, CLAUDE.md §22). */
export interface RetentionSweepJobData {
  assetId: string;
}

/** `platform.webhook_events` processing — RevenueCat, Stripe, LiveKit (`api-conventions` skill §9). */
export interface WebhookProcessorJobData {
  webhookEventId: string;
}

/** `phase-23-ai-assistant`, gated to Pro+ with a per-coach monthly cap (CLAUDE.md §15.2). */
export interface AiGenerationJobData {
  generationId: string;
}

/** `account-lifecycle/04` — the DB§19.2 transactional purge, one job per account. */
export interface AccountDeletionJobData {
  userId: string;
}
