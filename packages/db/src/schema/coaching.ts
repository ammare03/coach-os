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
  mediaKind,
  mediaStatus,
  mediaVisibility,
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
    // Who can see it.
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
    // concerns (DB§5.4's own comment on this column).
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
