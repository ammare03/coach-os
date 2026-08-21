// Drizzle tables for the `identity` Postgres schema (DATABASE.md DB§5.1) —
// users, auth providers, devices, coach/client profiles, coach notes, and
// invites. Transcribed column-for-column, constraint-for-constraint; where
// this file and DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md
// §0, phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, identitySchema, softDelete, timestamps } from './_shared.ts';
import { userRole, weightUnit } from './enums.ts';

// `avatar_asset_id` references `coaching.media_assets(id)` per DB§5.1, but
// that table doesn't exist until coaching-schema (a later feature in this
// same phase) — Drizzle has nothing to import yet. Declared here as a plain
// `uuid` column with no `.references()`; the FK constraint itself is added
// by an ALTER TABLE migration in coaching-schema once `media_assets` exists
// (identity-schema/01's documented forward-reference strategy 1 — strategy
// 2, a single cross-file schema graph, needs the target table's module to
// already exist, which it does not in this commit).
export const users = identitySchema.table(
  'users',
  {
    ...id,
    email: citext('email').notNull(),
    passwordHash: text('password_hash'), // null for social-only accounts
    name: text('name').notNull(),
    avatarAssetId: uuid('avatar_asset_id'), // FK added later — see comment above
    role: userRole('role').notNull(),
    timezone: text('timezone').notNull().default('UTC'), // IANA, e.g. 'Asia/Kolkata'
    locale: text('locale').notNull().default('en'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    analyticsOptOut: boolean('analytics_opt_out').notNull().default(false),
    aiProcessingOptOut: boolean('ai_processing_opt_out').notNull().default(false), // §8.11

    // Display preference ONLY. Every weight in this database is stored in
    // kg, always — conversion happens at the edges, in packages/utils, and
    // nowhere else (DB§5.1.1).
    weightUnit: weightUnit('weight_unit').notNull().default('kg'),

    // Age gating (§21.5). A coach must be >= 18, enforced in application
    // code at signup (not a CHECK — the constraint depends on now()). A
    // client may be 13-17 with guardian consent; under 13 is refused
    // outright.
    dateOfBirth: date('date_of_birth'),
    isMinor: boolean('is_minor').notNull().default(false), // derived at signup, re-evaluated by the birthday sweep (DB§15)
    guardianEmail: citext('guardian_email'), // 13-17 clients only
    guardianConsentAt: timestamp('guardian_consent_at', { withTimezone: true }), // null = consent not yet given

    // DPDP nomination right (COMPLIANCE.md CO§3.2). Recorded here; acting on
    // a claim is a manual, human-verified process — never automated.
    nomineeName: text('nominee_name'),
    nomineeEmail: citext('nominee_email'),

    internalOperator: boolean('internal_operator').notNull().default(false), // SUPPORT.md SU§2 — direct DB access only, no application surface sets it
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }), // moderation, null = not suspended
    bannedAt: timestamp('banned_at', { withTimezone: true }),

    ...softDelete,
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
    emailOrSocial: check(
      'users_email_or_social',
      sql`${t.passwordHash} IS NOT NULL OR ${t.emailVerifiedAt} IS NOT NULL`,
    ),
    minorIsClient: check('users_minor_is_client', sql`NOT ${t.isMinor} OR ${t.role} = 'client'`),
    minorHasGuardian: check(
      'users_minor_has_guardian',
      sql`NOT ${t.isMinor} OR ${t.guardianEmail} IS NOT NULL`,
    ),
  }),
);

export const authProviders = identitySchema.table(
  'auth_providers',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // CHECK (provider IN ('apple','google')) — DB§5.1 uses text + CHECK, not an enum
    providerUid: text('provider_uid').notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    providerCheck: check(
      'auth_providers_provider_check',
      sql`${t.provider} IN ('apple', 'google')`,
    ),
    providerUidUnique: uniqueIndex('auth_providers_provider_uid_unique').on(
      t.provider,
      t.providerUid,
    ),
    // DB§7: every FK is indexed, no exceptions — Postgres doesn't do this
    // for you. Neither of this table's other indexes leads with user_id.
    userIdIdx: index('auth_providers_user_id_idx').on(t.userId),
  }),
);

export const refreshTokens = identitySchema.table(
  'refresh_tokens',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(), // SHA-256. NEVER store the raw token — enforced in application code (auth-server/02, /04), not by this column.
    familyId: uuid('family_id').notNull(), // rotation family; reuse => revoke family
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }), // losing the device record must not invalidate an otherwise-valid session
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // Self-referencing rotation chain. DB§5.1's DDL leaves ON DELETE
    // unspecified here; DB§2's general cascade policy ("everything else
    // RESTRICT") is the more complete rule to fall back to when DATABASE.md
    // is silent on a specific FK (identity-schema/02 §Approach 2).
    replacedBy: uuid('replaced_by').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamps.createdAt,
  },
  (t) => ({
    // Partial: active-token queries (family validity, current active token)
    // never need to scan revoked history (DB§7).
    familyIdx: index('refresh_tokens_family')
      .on(t.familyId)
      .where(sql`${t.revokedAt} IS NULL`),
    // DB§7: every FK is indexed, no exceptions. None of these three are
    // covered by refresh_tokens_family (a different column).
    userIdIdx: index('refresh_tokens_user_id_idx').on(t.userId),
    deviceIdIdx: index('refresh_tokens_device_id_idx').on(t.deviceId),
    replacedByIdx: index('refresh_tokens_replaced_by_idx').on(t.replacedBy),
  }),
);

export const devices = identitySchema.table(
  'devices',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token'),
    platform: text('platform').notNull(), // CHECK (platform IN ('ios','android','web')) — DB§5.1 uses text + CHECK, not an enum
    appVersion: text('app_version'),
    osVersion: text('os_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => ({
    platformCheck: check('devices_platform_check', sql`${t.platform} IN ('ios', 'android', 'web')`),
    // Leads with user_id, so this also satisfies DB§7's "every FK is
    // indexed" for the user_id FK — no separate index needed.
    userPushTokenUnique: uniqueIndex('devices_user_id_expo_push_token_unique').on(
      t.userId,
      t.expoPushToken,
    ),
  }),
);
