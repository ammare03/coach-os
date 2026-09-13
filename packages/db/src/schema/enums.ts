// Native Postgres `CREATE TYPE ... AS ENUM` declarations, transcribed
// verbatim from DATABASE.md DB§4 — exact value lists, exact order. Order
// matters even where nothing currently sorts by it (DB§4's own note).
//
// These are deliberately declared with the schema-less `pgEnum`, not one of
// the five schema helpers from `_shared.ts`. DB§4's `CREATE TYPE` statements
// are unqualified, so every enum lands in `public` by Postgres default — an
// intentional choice (db-package-scaffold/02), not an omission to "fix"
// during transcription.
//
// Every table needing one of these imports it from here. A table declaring
// its own `pgEnum` inline creates a second, differently-named Postgres type
// — Drizzle will not catch the duplication.
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['coach', 'client', 'assistant']);

export const subscriptionTier = pgEnum('subscription_tier', [
  'starter',
  'coach',
  'pro',
  'studio',
  'agency',
]);

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'grace',
  'paused',
  'expired',
  'refunded',
]);

export const billingPlatform = pgEnum('billing_platform', [
  'app_store',
  'play_store',
  'stripe',
  'manual',
]);

export const clientStatus = pgEnum('client_status', ['invited', 'active', 'paused', 'archived']);

/**
 * `relationship-controls/03` — NOT in DB§4's original list, and the one
 * enum here that exists to be READ BACK rather than enforced.
 *
 * `client_profiles.history_shared_from` is a timestamp, deliberately
 * (`account-lifecycle/07`'s Risks: never a stored duration), and a
 * timestamp cannot be inverted to the option that produced it — *nothing*
 * six weeks ago and *12 weeks* today are two past instants nothing
 * distinguishes. The settings screen has to show the client the choice
 * they actually made, so the choice is stored beside the timestamp.
 *
 * Value order matches `historySharingInput`'s `z.enum` in
 * `packages/schemas/src/primitives.ts`, which is the wire contract this
 * column stores verbatim — one order in the product, not two.
 */
export const historySharingChoice = pgEnum('history_sharing_choice', [
  'twelve_weeks',
  'everything',
  'nothing',
]);

export const trainingGoal = pgEnum('training_goal', [
  'fat_loss',
  'muscle_gain',
  'performance',
  'health',
  'other',
]);

export const experienceLevel = pgEnum('experience_level', ['beginner', 'intermediate', 'advanced']);

export const movementPattern = pgEnum('movement_pattern', [
  'squat',
  'hinge',
  'push',
  'pull',
  'carry',
  'core',
  'isolation',
  'other',
]);

export const sessionStatus = pgEnum('session_status', [
  'scheduled',
  'in_progress',
  'completed',
  'skipped',
]);

export const assignmentStatus = pgEnum('assignment_status', [
  'active',
  'completed',
  'paused',
  'cancelled',
]);

export const mealType = pgEnum('meal_type', [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'pre_workout',
  'post_workout',
]);

export const foodSource = pgEnum('food_source', [
  'openfoodfacts',
  'usda',
  'coach',
  'client',
  'verified',
]);

export const mediaKind = pgEnum('media_kind', ['video', 'image', 'audio', 'document']);

export const mediaStatus = pgEnum('media_status', [
  'uploading',
  'processing',
  'ready',
  'failed',
  'deleted',
]);

export const mediaVisibility = pgEnum('media_visibility', ['coach_only', 'shared', 'private']);

export const commentTarget = pgEnum('comment_target', [
  'workout_session',
  'set_log',
  'meal',
  'media_asset',
  'checkin',
  'program_day',
  'body_metric',
]);

export const checkinStatus = pgEnum('checkin_status', [
  'pending',
  'submitted',
  'reviewed',
  'missed',
]);

export const checkinCadence = pgEnum('checkin_cadence', ['weekly', 'biweekly', 'monthly']);

export const liveSessionKind = pgEnum('live_session_kind', [
  'checkin_call',
  'live_workout',
  'group',
]);

export const photoAngle = pgEnum('photo_angle', ['front', 'side', 'back', 'custom']);

export const metricSource = pgEnum('metric_source', ['manual', 'checkin', 'coach']);

// Display only — DB§5.1. Every weight is stored in kg; this is never used to
// change what's persisted, only how it's rendered (CLAUDE.md hard rule).
export const weightUnit = pgEnum('weight_unit', ['kg', 'lb']);

export const reportTarget = pgEnum('report_target', ['message', 'comment', 'media_asset', 'user']);

export const reportReason = pgEnum('report_reason', [
  'harassment',
  'spam',
  'inappropriate_content',
  'impersonation',
  'unsafe_advice',
  'other',
]);

export const reportStatus = pgEnum('report_status', [
  'pending',
  'triaged',
  'actioned',
  'dismissed',
]);

export const moderationAction = pgEnum('moderation_action', [
  'none',
  'warning',
  'content_removed',
  'suspension',
  'ban',
]);

export const exportStatus = pgEnum('export_status', [
  'queued',
  'building',
  'ready',
  'failed',
  'expired',
]);
