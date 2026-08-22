// Drizzle tables for the `coaching` Postgres schema (DATABASE.md DB§5.4) —
// media, comments, check-ins, metrics, live sessions, and messaging.
// Transcribed column-for-column, constraint-for-constraint; where this file
// and DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md §0,
// phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { coachingSchema, id, timestamps } from './_shared.ts';
import { mediaKind, mediaStatus, mediaVisibility } from './enums.ts';
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
