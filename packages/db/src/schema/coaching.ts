// Drizzle tables for the `coaching` Postgres schema (DATABASE.md DB§5.4) —
// media, comments, check-ins, metrics, live sessions, and messaging.
// Transcribed column-for-column, constraint-for-constraint; where this file
// and DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md §0,
// phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { coachingSchema, id, timestamps } from './_shared.ts';
import {
  checkinCadence,
  checkinStatus,
  commentTarget,
  liveSessionKind,
  mediaKind,
  mediaStatus,
  mediaVisibility,
  metricSource,
  photoAngle,
} from './enums.ts';
import { clientProfiles, coachProfiles, users } from './identity.ts';
import { exercises, setLogs, workoutSessions } from './training.ts';

// The four earlier forward references to this table — `identity.users
// .avatar_asset_id`, `identity.coach_profiles.brand_logo_asset_id`,
// `training.exercises.demo_asset_id`, and `nutrition.meals.photo_asset_id`
// — are resolved by that column now importing `mediaAssets` from this
// module and supplying `.references()` directly (each uses the same
// `(): AnyPgColumn => …` thunk pattern `coach_profiles.parent_coach_id`
// already established for its self-reference, identity-schema/05). This is
// "strategy 2" from those tasks' own comments — a single cross-file schema
// graph — now viable because this module exists; those comments are
// updated in this same commit rather than left stale. The cross-file
// imports this creates (identity.ts ⇄ coaching.ts, training.ts ⇄
// coaching.ts) are circular but safe: `.references()` takes a thunk, never
// evaluated until Drizzle actually resolves the FK, by which point every
// module has finished loading.
export const mediaAssets = coachingSchema.table(
  'media_assets',
  {
    ...id,
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Who can see it. DB§6-denormalised — unlike every other guarded table
    // in this schema, neither column here is clearly "primary FK, other
    // derived": a media asset isn't strictly owned by one client the way a
    // set_log is, so both are independently guarded by
    // `media_assets_no_coach_change` / `media_assets_no_client_change`
    // (derived-data/02, migrations/0022_guard_triggers.sql).
    coachId: uuid('coach_id').references(() => coachProfiles.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clientProfiles.id, { onDelete: 'cascade' }),
    kind: mediaKind('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(), // R2 object key, DB§16
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    durationSeconds: numeric('duration_seconds', { precision: 8, scale: 2 }),
    width: integer('width'),
    height: integer('height'),
    // Normalise! iOS and Android capture orientation differently —
    // annotations render rotated 90° on one platform unless this is
    // normalised during transcode (CLAUDE.md §25.10, phase-11-media-
    // pipeline/transcode-worker/04's job, not this task's).
    orientation: smallint('orientation'),
    thumbnailKey: text('thumbnail_key'),
    blurhash: text('blurhash'),
    playbackId: text('playback_id'), // HLS manifest id
    processingStatus: mediaStatus('processing_status').notNull().default('uploading'),
    processingError: text('processing_error'),
    visibility: mediaVisibility('visibility').notNull().default('coach_only'),

    // What this media is ABOUT (all nullable; a demo video has none of these).
    exerciseId: uuid('exercise_id').references(() => exercises.id, { onDelete: 'set null' }),
    workoutSessionId: uuid('workout_session_id').references(() => workoutSessions.id, {
      onDelete: 'set null',
    }),
    setLogId: uuid('set_log_id').references(() => setLogs.id, { onDelete: 'set null' }),

    expiresAt: timestamp('expires_at', { withTimezone: true }), // retention, DB§12
    // Last 30/7/1-day warning sent, DB§19.1. Added post-hoc for
    // phase-11-media-pipeline/retention-and-quota/02's exactly-once warning
    // cadence — nullable, additive, no behavioural change for any row until
    // that task's sweep job exists.
    retentionWarnedAt: timestamp('retention_warned_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    sizeBytesNonNegative: check('media_assets_size_bytes_check', sql`${t.sizeBytes} >= 0`),
    // "Is my upload still processing."
    ownerStatusIdx: index('media_owner_status').on(t.ownerUserId, t.processingStatus),
    // The coach's unreviewed-videos count, and one branch of DB§22's
    // coach-inbox UNION query. Both conditions matter: missing
    // `processing_status = 'ready'` would surface videos still processing;
    // missing `deleted_at IS NULL` would surface ones already soft-deleted.
    coachUnreviewedIdx: index('media_coach_unreviewed')
      .on(t.coachId, t.createdAt.desc())
      .where(sql`${t.processingStatus} = 'ready' AND ${t.deletedAt} IS NULL`),
    // What the nightly retention-sweep job scans
    // (phase-11-media-pipeline/retention-and-quota/02).
    expiringIdx: index('media_expiring')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  }),
);

// DATABASE.md §5.4 states it without hedging: `comments` is deliberately
// polymorphic, and it is the heart of the product — every piece of coach
// feedback (on a set, a meal, a video, a check-in) is a row here.
// `target_id` is intentionally a bare uuid with NO foreign key: DB§10 calls
// this "a real loss of integrity, accepted deliberately," because a real FK
// would require picking one target table and defeat the entire polymorphic
// design. `comment_target` is the only type safety this relationship has.
//
// DB§10 names four mitigations for the resulting gap. This task's
// contribution to each, so nothing is silently dropped between the schema
// and its enforcement:
//   1. `client_id` denormalised onto every comment, always resolvable
//      regardless of `target_type` — THIS TASK, the column below.
//   2. A single application-layer resolver validates `target_id` exists in
//      the table `target_type` implies, in the same transaction as the
//      insert; nothing else may insert into `comments` —
//      phase-12-feedback-comments/comment-core/02 (does not exist yet).
//   3. A nightly orphan sweep counts comments whose target no longer
//      exists and alerts above a threshold; orphans are soft-deleted, never
//      hard-deleted — phase-12-feedback-comments/comment-core/03.
//   4. Deleting a target explicitly soft-deletes its comments in
//      application code — there is no cascade to rely on. Each phase that
//      deletes a commentable thing owns this for its own target type.
// Until mitigation 2 exists, a direct insert with a `target_id` matching no
// row anywhere succeeds at the schema level — a known, accepted gap, not a
// bug (see this file's own verification below and coaching-schema/02's
// task doc).
export const comments = coachingSchema.table(
  'comments',
  {
    ...id,
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: commentTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(), // polymorphic; see DB§10, no FK — deliberate
    // Always resolvable — the key to how authorisation works on a table
    // that otherwise has no reliable path from a comment to the client it
    // concerns (DB§5.4's own comment on this column). Guarded by
    // `comments_no_owner_change` (derived-data/02,
    // migrations/0022_guard_triggers.sql).
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    body: text('body'),
    voiceNoteAssetId: uuid('voice_note_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    videoReplyAssetId: uuid('video_reply_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    timestampMs: integer('timestamp_ms'), // position within a video
    annotation: jsonb('annotation'), // [{frame_ms, strokes:[…], shape}] — §8.6
    // A reply's existence is tied to its parent — CASCADE, unlike
    // refresh_tokens.replaced_by's self-reference (no cascade there,
    // identity-schema/02), because a superseded refresh token is a
    // historical record worth keeping while a reply genuinely has no
    // meaning independent of the comment it replies to.
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    isAiGenerated: boolean('is_ai_generated').notNull().default(false), // §8.11, must be labelled
    readAt: timestamp('read_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    hasContent: check(
      'comment_has_content',
      sql`${t.body} IS NOT NULL OR ${t.voiceNoteAssetId} IS NOT NULL OR ${t.videoReplyAssetId} IS NOT NULL OR ${t.annotation} IS NOT NULL`,
    ),
    timestampNonNegative: check('comments_timestamp_ms_check', sql`${t.timestampMs} >= 0`),
    // Loading every comment on a given thing, reverse-chronological.
    targetIdx: index('comments_target')
      .on(t.targetType, t.targetId, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // The client's feedback-inbox unread badge — only possible because
    // client_id is denormalised onto every comment regardless of target.
    clientUnreadIdx: index('comments_client_unread')
      .on(t.clientId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL AND ${t.deletedAt} IS NULL`),
  }),
);

// Same polymorphic shape as `comments`, minus the client_id denormalisation
// — reactions are lighter-weight and DB§5.4 doesn't carry that column for
// them. Do not "correct" this to match `comments`; it's not an oversight.
export const reactions = coachingSchema.table(
  'reactions',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: commentTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    reactionUnique: uniqueIndex('reactions_user_target_emoji_unique').on(
      t.userId,
      t.targetType,
      t.targetId,
      t.emoji,
    ),
  }),
);

export const checkinTemplates = coachingSchema.table(
  'checkin_templates',
  {
    ...id,
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cadence: checkinCadence('cadence').notNull().default('weekly'),
    dueWeekday: smallint('due_weekday'), // 0-6, CHECK below
    // Ordered [{key,label,type,required,options,min,max}] — one of DB§2's
    // six deliberate jsonb uses: a coach-defined field list is genuinely
    // schemaless. NOT NULL (a template with no fields at all is
    // meaningless), but nothing here requires the array itself be non-empty.
    fields: jsonb('fields').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    dueWeekdayBound: check(
      'checkin_templates_due_weekday_check',
      sql`${t.dueWeekday} BETWEEN 0 AND 6`,
    ),
  }),
);

// `template_snapshot` is the column deserving the most scrutiny here: it
// freezes `checkin_templates.fields` AS THEY WERE at creation time (DB§5.4's
// own comment), so a coach editing their template next month never
// retroactively changes what a client's check-in from last month appears to
// have asked. NOT NULL, same as `fields` above — but nothing in this
// schema populates it; phase-17-structured-checkins/checkin-scheduler/01's
// auto-creation logic is what actually copies the template's fields in at
// generation time. The NOT NULL constraint proves this column was written
// to; it cannot prove it was written to correctly.
export const checkins = coachingSchema.table(
  'checkins',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    // Denormalised, DB§6 — client_id above is the primary FK (whose
    // check-in this is); this column exists for checkins_coach_pending's
    // query shape. Guarded by `checkins_no_owner_change` (derived-data/02,
    // migrations/0022_guard_triggers.sql).
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    // A check-in survives its template being deleted.
    templateId: uuid('template_id').references(() => checkinTemplates.id, {
      onDelete: 'set null',
    }),
    templateSnapshot: jsonb('template_snapshot').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: checkinStatus('status').notNull().default('pending'),
    responses: jsonb('responses').notNull().default({}), // {field_key: value}
    draftResponses: jsonb('draft_responses'), // autosave, §8.7 AC — NOT `responses`, a different column
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    coachSummary: text('coach_summary'),
    coachVideoAssetId: uuid('coach_video_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => ({
    periodCheck: check('checkin_period', sql`${t.periodEnd} >= ${t.periodStart}`),
    clientPeriodUnique: uniqueIndex('checkins_client_period_unique').on(t.clientId, t.periodStart),
    // The coach's check-ins-due counter and one branch of §8.2's
    // dashboard three-counter row. A checkin already 'reviewed' or
    // 'missed' must not count toward it.
    coachPendingIdx: index('checkins_coach_pending')
      .on(t.coachId, t.periodEnd)
      .where(sql`${t.status} IN ('pending', 'submitted')`),
  }),
);

export const bodyMetrics = coachingSchema.table(
  'body_metrics',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    recordedDate: date('recorded_date').notNull(), // client-local, for charting
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
    bodyFatPct: numeric('body_fat_pct', { precision: 4, scale: 1 }),
    waistCm: numeric('waist_cm', { precision: 5, scale: 1 }),
    hipCm: numeric('hip_cm', { precision: 5, scale: 1 }),
    chestCm: numeric('chest_cm', { precision: 5, scale: 1 }),
    armCm: numeric('arm_cm', { precision: 5, scale: 1 }),
    thighCm: numeric('thigh_cm', { precision: 5, scale: 1 }),
    neckCm: numeric('neck_cm', { precision: 5, scale: 1 }),
    source: metricSource('source').notNull().default('manual'),
    checkinId: uuid('checkin_id').references(() => checkins.id, { onDelete: 'set null' }),
    // Nullable, unlike set_logs' mandatory version (training-schema/04) — a
    // check-in-sourced metric never goes through the offline outbox at all;
    // only the manual/offline entry path needs the idempotency key.
    clientLocalId: text('client_local_id'),
    ...timestamps,
  },
  (t) => ({
    weightBound: check('body_metrics_weight_kg_check', sql`${t.weightKg} BETWEEN 20 AND 400`),
    bodyFatBound: check('body_metrics_body_fat_pct_check', sql`${t.bodyFatPct} BETWEEN 1 AND 70`),
    clientDateIdx: index('body_metrics_client_date').on(t.clientId, t.recordedDate.desc()),
  }),
);

// ⚠️ HIGHEST SENSITIVITY. See DATABASE.md DB§18. Never joined into any
// export, analytics, or AI prompt. This warning is preserved verbatim from
// DB§5.4's own comment on this table so it travels with the code, not only
// with the planning docs — a future contributor scanning this file for
// what's safe to log or send to an AI context builder
// (phase-23-ai-assistant) needs to hit it here, at the point of use.
//
// Both foreign keys CASCADE — unusual for a media reference in this
// schema, where SET NULL is the norm (media_assets' own exercise_id /
// workout_session_id / set_log_id, coaching-schema/01). A progress photo
// genuinely has no independent meaning once either its client or its
// underlying asset is gone, unlike a coach's demo video, which retains
// value even if a specific exercise reference is removed.
export const progressPhotos = coachingSchema.table('progress_photos', {
  ...id,
  clientId: uuid('client_id')
    .notNull()
    .references(() => clientProfiles.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  angle: photoAngle('angle').notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
  checkinId: uuid('checkin_id').references(() => checkins.id, { onDelete: 'set null' }),
  createdAt: timestamps.createdAt, // no updated_at — taken once, never modified in place
});

export const habits = coachingSchema.table(
  'habits',
  {
    ...id,
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    targetPerWeek: smallint('target_per_week').notNull().default(7),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    targetPerWeekBound: check(
      'habits_target_per_week_check',
      sql`${t.targetPerWeek} BETWEEN 1 AND 7`,
    ),
  }),
);

export const habitLogs = coachingSchema.table(
  'habit_logs',
  {
    ...id,
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    completed: boolean('completed').notNull().default(true),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    habitDateUnique: uniqueIndex('habit_logs_habit_date_unique').on(t.habitId, t.date),
  }),
);

// `live_sessions` is a REPLICA, not the system of record — LiveKit owns
// live room/participant state (DB§17); this table is populated by egress
// webhooks. Nothing here enforces staying in sync with LiveKit's actual
// state; that reconciliation is phase-19-live-sessions/livekit-
// integration/03's reaper-job responsibility.
export const liveSessions = coachingSchema.table(
  'live_sessions',
  {
    ...id,
    // Denormalised, DB§6 — set by the coach who starts the session.
    // Guarded by `live_sessions_no_owner_change` (derived-data/02,
    // migrations/0022_guard_triggers.sql). client_id below is not
    // guarded — it's nullable ("who's invited," not derived from
    // coach_id) and legitimately null for a group session.
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clientProfiles.id, { onDelete: 'cascade' }), // null for group
    roomName: text('room_name').notNull().unique(),
    kind: liveSessionKind('kind').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    participantMinutes: integer('participant_minutes').notNull().default(0), // billing meter, §15.8
    recordingAssetId: uuid('recording_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    coachConsentAt: timestamp('coach_consent_at', { withTimezone: true }),
    clientConsentAt: timestamp('client_consent_at', { withTimezone: true }),
    workoutSessionId: uuid('workout_session_id').references(() => workoutSessions.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    // Recording without dual consent is structurally impossible (§8.9 AC).
    // This is an OR between "no recording at all" and "both consents
    // present" — NOT "at least one consent," which would be a materially
    // weaker and incorrect guarantee. The single highest-consequence
    // constraint in this entire phase: it is the literal mechanism behind
    // a user-facing trust and legal guarantee, not just data integrity.
    dualConsentRequired: check(
      'recording_requires_dual_consent',
      sql`${t.recordingAssetId} IS NULL OR (${t.coachConsentAt} IS NOT NULL AND ${t.clientConsentAt} IS NOT NULL)`,
    ),
  }),
);

export const liveSessionParticipants = coachingSchema.table(
  'live_session_participants',
  {
    ...id,
    liveSessionId: uuid('live_session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => ({
    // Three-column uniqueness, not just (live_session_id, user_id) — a
    // participant can leave and rejoin the same session, producing
    // multiple rows; joined_at in the key is what lets each rejoin be a
    // distinct row rather than colliding with the first.
    rejoinUnique: uniqueIndex('live_session_participants_unique').on(
      t.liveSessionId,
      t.userId,
      t.joinedAt,
    ),
  }),
);

export const conversations = coachingSchema.table(
  'conversations',
  {
    ...id,
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clientProfiles.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamps.createdAt, // no updated_at
  },
  (t) => ({
    // Exactly one conversation thread per coach-client pair — §8.8's model
    // of the chat as one continuous thread, not per-topic channels.
    coachClientUnique: uniqueIndex('conversations_coach_client_unique').on(t.coachId, t.clientId),
  }),
);

export const messages = coachingSchema.table(
  'messages',
  {
    ...id,
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body'),
    attachmentAssetId: uuid('attachment_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    // Reuses the SAME comment_target enum `comments` uses (task 02) — not a
    // new declaration — for the "re: Tuesday's Squat set 3" deep-link
    // feature (§8.8). No FK on linked_target_id, same reasoning as
    // comments.target_id.
    linkedTargetType: commentTarget('linked_target_type'),
    linkedTargetId: uuid('linked_target_id'),
    // NOT NULL, unlike comments — a sent message always has offline
    // provenance (§8.8).
    clientLocalId: text('client_local_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamps.createdAt, // no updated_at — a sent message is not edited in place
  },
  (t) => ({
    hasContent: check(
      'message_has_content',
      sql`${t.body} IS NOT NULL OR ${t.attachmentAssetId} IS NOT NULL`,
    ),
    // Loading a conversation's history.
    conversationIdx: index('messages_conversation')
      .on(t.conversationId, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    // Scoped by SENDER, not conversation — the offline-idempotency key is
    // unique per sending user's mutation stream (whose device actually
    // generated client_local_id), consistent with this column's meaning
    // elsewhere in this phase, not "unique per conversation."
    localUnique: uniqueIndex('messages_local').on(t.senderUserId, t.clientLocalId),
  }),
);
