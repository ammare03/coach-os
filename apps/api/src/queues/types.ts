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

/**
 * `account-lifecycle/09` — walks the DB§19.2 table inventory for one user,
 * packages it, uploads to `exports/`, and emails the subject. Keyed on the
 * `export_requests` row's own id, not `userId` — unlike account deletion,
 * a user may have more than one export row over time (a new one every 24h,
 * `account-lifecycle/10`), so the subject of this job is the specific
 * request, not the account.
 */
export interface DataExportJobData {
  exportId: string;
}

/**
 * `exercise-library/06` — DB§15's `exercise-reconcile` queue. A union, not
 * the single-subject-id shape every other payload here uses, because this
 * queue carries two job kinds on one schedule: the weekly `sweep` that BullMQ's
 * own job scheduler emits, and the per-coach `reconcile` jobs that sweep
 * fans out. One queue, per DB§15's fixed queue list — never a second one.
 */
export type ExerciseReconcileJobData =
  /** The weekly fan-out. Enumerates coaches and enqueues one `reconcile` job each. */
  | { kind: 'sweep' }
  /** One coach's four passes for one ISO week. */
  | { kind: 'reconcile'; coachId: string; isoWeek: string };
