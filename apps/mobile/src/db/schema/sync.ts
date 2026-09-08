// `outbox`, `upload_queue`, `meta` — DB§13, DB§14 (the sync contract these
// tables exist to serve).
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// THE OUTBOX — every offline mutation, queued for flush (DB§11.3, DB§14).
export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(), // uuidv7
    procedure: text('procedure').notNull(), // e.g. 'workouts.logSet'
    payloadJson: text('payload_json').notNull(),
    clientLocalId: text('client_local_id').notNull(), // idempotency key sent to the server, DB§14.1
    // Self-reference for ordering (a session before its sets, DB§14.2). Same
    // `(): AnySQLiteColumn => …` thunk pattern `packages/db`'s
    // `coachProfiles.parentCoachId` uses for its own self-reference, needed
    // because the column references its own not-yet-fully-built table.
    dependsOn: text('depends_on').references((): AnySQLiteColumn => outbox.id),
    createdAt: integer('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    lastError: text('last_error'),
    status: text('status', { enum: ['queued', 'inflight', 'failed', 'done'] })
      .notNull()
      .default('queued'),
  },
  (t) => ({
    // The index `outbox/02`'s flush loop scans continuously — column order
    // (status, next_attempt_at) is exact, not incidental.
    outboxReady: index('outbox_ready').on(t.status, t.nextAttemptAt),
  }),
);

// Video/photo uploads, survives an app kill — a byte transfer, not a
// mutation, so it is deliberately not routed through the outbox above
// (offline-sync skill §7).
export const uploadQueue = sqliteTable('upload_queue', {
  id: text('id').primaryKey(),
  localUri: text('local_uri').notNull(),
  assetId: text('asset_id'),
  uploadUrl: text('upload_url'),
  bytesTotal: integer('bytes_total'),
  bytesSent: integer('bytes_sent').default(0),
  partsJson: text('parts_json'),
  status: text('status').notNull(),
  attempts: integer('attempts').default(0),
});

// Arbitrary key/value: schema_version, last_sync_at, user_id (DB§13).
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// `health_exports` is in DB§13's literal SQL but deliberately NOT
// transcribed here — it belongs to `phase-24-health-sync`, per DB§13's own
// comment on that table ("Device-local record of which completed sessions
// were written to Apple Health / Health Connect"). This task's Scope section
// names exactly nine tables and health_exports isn't one of them; its
// absence is deliberate, not an oversight.

// Bootstrap DDL — see `local-training.ts`'s copy of this comment for why
// this exists alongside the typed definitions above instead of being
// generated from them. `outbox_ready`'s column order, (status,
// next_attempt_at), is exact — task 02's own acceptance criterion.
export const SYNC_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    procedure TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    client_local_id TEXT NOT NULL,
    depends_on TEXT REFERENCES outbox(id),
    created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
  )`,
  `CREATE INDEX IF NOT EXISTS outbox_ready ON outbox (status, next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS upload_queue (
    id TEXT PRIMARY KEY,
    local_uri TEXT NOT NULL,
    asset_id TEXT,
    upload_url TEXT,
    bytes_total INTEGER,
    bytes_sent INTEGER DEFAULT 0,
    parts_json TEXT,
    status TEXT NOT NULL,
    attempts INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];
