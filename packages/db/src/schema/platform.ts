// Drizzle tables for the `platform` Postgres schema (DATABASE.md DB§5.5) —
// notifications, the append-only audit log, storage/feature-usage
// counters, and the webhook idempotency ledger. Transcribed
// column-for-column, constraint-for-constraint; where this file and
// DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md §0,
// phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, platformSchema, timestamps } from './_shared.ts';
import { users } from './identity.ts';

// `type` is deliberately bare `text`, not an enum — DB§5.5 transcribes it
// this way even though CLAUDE.md §14.1 lists ten known values today. A
// growing, product-defined value set (new notification types are one of
// the more probable schema changes ahead) stays text per DB§4's own
// guidance; an enum here would hit the exact ALTER TYPE limitation DB§4
// warns about. Not "fixed" toward the schema's many enum columns elsewhere.
export const notifications = platformSchema.table(
  'notifications',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // §14.1
    title: text('title').notNull(),
    body: text('body').notNull(),
    // MUST contain data.route (DB§5.5's own comment) — a jsonb column
    // cannot enforce a specific key's presence, so this is entirely an
    // application-layer contract. phase-15-notifications/deep-link-
    // routing/01 is responsible for upholding it on every write.
    data: jsonb('data').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamps.createdAt, // no updated_at — create, send, maybe fail, maybe get read; not arbitrary editing
  },
  (t) => ({
    // The unread-list query.
    userUnreadIdx: index('notifications_user_unread')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL`),
  }),
);

// Composite primary key, no surrogate id — the same deliberate exception
// pattern nutrition.daily_nutrition_summary established (nutrition-schema/02).
// `channel` is text + CHECK, not an enum, matching identity.devices.platform's
// pattern (identity-schema/01) — a small genuinely-closed set expressed
// this way is DB§5.5's actual choice, not an inconsistency to "fix" toward
// the schema's many enum columns.
export const notificationPreferences = platformSchema.table(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.channel, t.type] }),
    channelCheck: check(
      'notification_preferences_channel_check',
      sql`${t.channel} IN ('push', 'email')`,
    ),
  }),
);

// APPEND-ONLY, by database rule, not just convention — DB§8.3 attaches
// two Postgres RULEs (audit_log_no_update, audit_log_no_delete) below this
// table's own CREATE TABLE in the migration; Drizzle's schema builder has
// no first-class representation for CREATE RULE, so they're added by hand
// to the generated migration SQL, the same way training-schema/01 hand-
// added its IMMUTABLE wrapper function.
//
// ⚠️ These rules use `DO INSTEAD NOTHING`, which is NOT the same as a
// rejecting trigger. An UPDATE or DELETE against this table does not
// raise an error — it reports success and changes nothing. A developer
// "fixing" a bad audit row at a psql prompt will believe the fix worked
// when it silently did not. This is deliberate (DB§8.3) and is the exact
// mechanism DB§19.2's account-purge procedure relies on: `actor_user_id`
// is set null on the referencing user's deletion, but the row itself is
// permanent — retained as compliance evidence even through the purge that
// nulled its actor.
//
// BUG FIX, found live in this task's own Verification step:
// `audit_log_no_update` is NOT the unconditional rule DB§8.3 originally
// specified — that version silently breaks `actor_user_id`'s own
// `ON DELETE SET NULL` (Postgres detects the rule rewrote the FK's
// internal UPDATE into a no-op and raises a hard "referential integrity
// query ... gave unexpected result" error). The migration's `WHERE`
// clause narrowly exempts exactly one update shape — `actor_user_id`
// going non-null → null with every other column unchanged — so the FK
// action (and any future explicit purge-time UPDATE, DB§19.2 step 6)
// still works, while every other UPDATE, including one that tries to
// null `actor_user_id` alongside changing anything else, stays silently
// blocked. See migrations/0019_audit_log.sql for the exact condition.
//
// The one table in this entire schema using `bigserial` instead of
// UUIDv7 — a purely append-only, purely sequential log has no need for
// UUIDv7's distributed-generation benefit, and a plain auto-incrementing
// integer is smaller and equally sufficient (DB§5.5).
export const auditLog = platformSchema.table(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // dotted namespace convention, e.g. 'auth.login', 'media.delete', 'account.purge'
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamps.createdAt, // no updated_at — append-only, nothing is ever edited
  },
  (t) => ({
    actorTimeIdx: index('audit_actor_time').on(t.actorUserId, t.createdAt.desc()),
  }),
);
