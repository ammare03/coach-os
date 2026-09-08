// `local_comments` — DB§13.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// DB§13 elides this table as "last 30 days, read-only mirror". Mirrors
// `packages/db/src/schema/coaching.ts`'s `comments` table, kept to only what
// a feedback thread needs to render offline. Read-only: nothing on-device
// ever writes here except the sync engine's pull, so unlike the offline-
// WRITABLE tables above there is no clientLocalId and no syncState. No
// coachId denormalisation, no deletedAt/readAt (a cache, not a mirror — task
// 02 decision #3; deletion and unread state are server concerns). Asset ids
// only, never a signed URL (DB§13 device DB rules).
export const localComments = sqliteTable('local_comments', {
  id: text('id').primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  authorUserId: text('author_user_id').notNull(),
  body: text('body'),
  voiceNoteAssetId: text('voice_note_asset_id'),
  videoReplyAssetId: text('video_reply_asset_id'),
  timestampMs: integer('timestamp_ms'), // position within a video
  annotationJson: text('annotation_json'), // [{frame_ms, strokes:[…], shape}], §8.6
  parentCommentId: text('parent_comment_id'),
  isAiGenerated: integer('is_ai_generated', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(), // epoch ms
});

// Bootstrap DDL — see `local-training.ts`'s copy of this comment for why
// this exists alongside the typed definition above instead of being
// generated from it.
export const LOCAL_FEEDBACK_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS local_comments (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    author_user_id TEXT NOT NULL,
    body TEXT,
    voice_note_asset_id TEXT,
    video_reply_asset_id TEXT,
    timestamp_ms INTEGER,
    annotation_json TEXT,
    parent_comment_id TEXT,
    is_ai_generated INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
];
