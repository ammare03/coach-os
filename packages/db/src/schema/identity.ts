// Drizzle tables for the `identity` Postgres schema (DATABASE.md DB§5.1) —
// users, auth providers, devices, coach/client profiles, coach notes, and
// invites. Transcribed column-for-column, constraint-for-constraint; where
// this file and DATABASE.md ever disagree, DATABASE.md is the bug (CLAUDE.md
// §0, phase-01-data-layer/README.md).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, identitySchema, softDelete, timestamps } from './_shared.ts';
import {
  billingPlatform,
  clientStatus,
  experienceLevel,
  subscriptionStatus,
  subscriptionTier,
  trainingGoal,
  userRole,
  weightUnit,
} from './enums.ts';

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

// `parent_coach_id` (the assistant-coach hierarchy column) and its guard
// trigger are identity-schema/05's job, not this task's — DB§5.1's DDL
// shows it inline in one CREATE TABLE, but the task breakdown deliberately
// splits it into its own reviewable migration. Every coach is a root coach
// until task 05 lands.
//
// `brand_logo_asset_id` has the same forward-reference problem as
// `users.avatar_asset_id` (identity-schema/01): `coaching.media_assets`
// doesn't exist yet, so this is strategy 1 again — a plain `uuid` column,
// FK added later by coaching-schema.
export const coachProfiles = identitySchema.table(
  'coach_profiles',
  {
    ...id,
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    businessName: text('business_name'),
    bio: text('bio'),
    specialties: text('specialties').array().notNull().default([]),
    certifications: text('certifications').array().notNull().default([]),
    instagramHandle: text('instagram_handle'),
    website: text('website'),
    brandPrimaryColor: text('brand_primary_color'),
    brandLogoAssetId: uuid('brand_logo_asset_id'), // FK added later — see comment above

    // Billing replica; RevenueCat is the system of record (§15.7).
    subscriptionTier: subscriptionTier('subscription_tier').notNull().default('starter'),
    subscriptionStatus: subscriptionStatus('subscription_status').notNull().default('active'),
    billingPlatform: billingPlatform('billing_platform'),
    revenuecatAppUserId: text('revenuecat_app_user_id').unique(),
    storeTransactionId: text('store_transaction_id'),
    stripeCustomerId: text('stripe_customer_id'), // Agency / web only
    billingCountry: char('billing_country', { length: 2 }), // ISO-3166-1 alpha-2 storefront, from RevenueCat
    // ISO-4217, from RevenueCat. Reporting and support copy ONLY — never an
    // input to an entitlement, seat, or feature decision (§15.6).
    billingCurrency: char('billing_currency', { length: 3 }),
    seatPacks: integer('seat_packs').notNull().default(0),
    entitlementExpiresAt: timestamp('entitlement_expires_at', { withTimezone: true }),
    trialUsedAt: timestamp('trial_used_at', { withTimezone: true }),
    billingSyncedAt: timestamp('billing_synced_at', { withTimezone: true }),

    quietHoursStart: time('quiet_hours_start'), // §8.8 coach availability
    quietHoursEnd: time('quiet_hours_end'),
    ...softDelete,
    ...timestamps,
  },
  (t) => ({
    // NOTE: client_seat_limit is DERIVED in packages/utils, never stored
    // (§15.7) — no column for it exists here, and none should without a
    // CLAUDE.md §27 decision entry.
    brandColorHex: check(
      'coach_profiles_brand_primary_color_check',
      sql`${t.brandPrimaryColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    seatPacksBound: check('coach_profiles_seat_packs_check', sql`${t.seatPacks} BETWEEN 0 AND 3`),
  }),
);

export const clientProfiles = identitySchema.table(
  'client_profiles',
  {
    ...id,
    // NOT a plain-unique column, deliberately — DB§5.1's own DDL text
    // writes `UNIQUE` inline here, but that directly contradicts the very
    // next line's `client_profiles_one_active_coach` partial index (and
    // this task's own "Why this exists" section, which explains at length
    // why the partial index — not a plain UNIQUE — is the real invariant).
    // A plain UNIQUE would make that index dead code and would also
    // permanently block ever reassigning a client to a new coach after
    // detachment, since even a soft-deleted row's user_id would collide
    // with a new one. Treated as a drafting error in DATABASE.md's DDL
    // block, not something to transcribe (identity-schema/03).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The DIRECTLY-responsible coach — root or assistant, whichever
    // currently handles this client day to day (DB§5.1). RESTRICT: a coach
    // with active clients cannot be deleted out from under them — the §21.4
    // detachment flow must run first. Never CASCADE — client data survives
    // the coach relationship ending (CLAUDE.md §21.3).
    coachId: uuid('coach_id')
      .notNull()
      .references(() => coachProfiles.id, { onDelete: 'restrict' }),
    status: clientStatus('status').notNull().default('invited'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    seatHoldUntil: timestamp('seat_hold_until', { withTimezone: true }), // anti-gaming, §15.5

    dateOfBirth: date('date_of_birth'),
    sexAtBirth: text('sex_at_birth'), // CHECK (sex_at_birth IN (...)) — DB§5.1 uses text + CHECK, not an enum
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    goal: trainingGoal('goal'),
    goalNotes: text('goal_notes'),
    experienceLevel: experienceLevel('experience_level'),
    trainingDaysPerWeek: smallint('training_days_per_week'),
    equipmentAccess: text('equipment_access').array().notNull().default([]),
    dietaryRestrictions: text('dietary_restrictions').array().notNull().default([]),
    injuries: jsonb('injuries').notNull().default([]), // [{area,notes,since,severity}]

    targetCalories: integer('target_calories'),
    targetProteinG: integer('target_protein_g'),
    targetCarbsG: integer('target_carbs_g'),
    targetFatG: integer('target_fat_g'),
    targetsByWeekday: jsonb('targets_by_weekday'), // {"1":{cal,p,c,f}, ...} §8.5

    ...softDelete,
    ...timestamps,
  },
  (t) => ({
    sexAtBirthCheck: check(
      'client_profiles_sex_at_birth_check',
      sql`${t.sexAtBirth} IN ('male', 'female', 'intersex', 'prefer_not_to_say')`,
    ),
    heightBound: check('client_profiles_height_cm_check', sql`${t.heightCm} BETWEEN 50 AND 260`),
    trainingDaysBound: check(
      'client_profiles_training_days_per_week_check',
      sql`${t.trainingDaysPerWeek} BETWEEN 0 AND 14`,
    ),
    targetCaloriesBound: check(
      'client_profiles_target_calories_check',
      sql`${t.targetCalories} BETWEEN 500 AND 10000`,
    ),
    targetProteinBound: check(
      'client_profiles_target_protein_g_check',
      sql`${t.targetProteinG} >= 0`,
    ),
    targetCarbsBound: check('client_profiles_target_carbs_g_check', sql`${t.targetCarbsG} >= 0`),
    targetFatBound: check('client_profiles_target_fat_g_check', sql`${t.targetFatG} >= 0`),
    statusTimestamps: check(
      'client_status_timestamps',
      sql`(${t.status} <> 'active' OR ${t.activatedAt} IS NOT NULL) AND (${t.status} <> 'archived' OR ${t.archivedAt} IS NOT NULL)`,
    ),
    // A client belongs to exactly one coach at a time (§8.1 AC) — the
    // single most security-relevant index in this schema.
    oneActiveCoach: uniqueIndex('client_profiles_one_active_coach')
      .on(t.userId)
      .where(sql`${t.deletedAt} IS NULL`),
    // DB§7's own named indexes for this table — both lead with coach_id, so
    // together they also satisfy "every FK is indexed" for the coach_id FK.
    coachStatusIdx: index('client_profiles_coach').on(t.coachId, t.status),
    // Seat counting, §15.5.
    activeSeatsIdx: index('client_profiles_active_seats')
      .on(t.coachId)
      .where(sql`${t.status} IN ('active', 'invited') AND ${t.deletedAt} IS NULL`),
  }),
);
