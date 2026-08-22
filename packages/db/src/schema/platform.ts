// Drizzle tables for the `platform` Postgres schema (DATABASE.md DB§5.5) —
// notifications, the append-only audit log, storage/feature-usage
// counters, and the webhook idempotency ledger. Transcribed
// column-for-column, constraint-for-constraint; where this file and
// DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md §0,
// phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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
