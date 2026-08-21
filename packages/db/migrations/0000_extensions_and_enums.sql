-- DB§2.1 — the four extensions this schema needs, and no others. Not
-- declarable through Drizzle's schema (there is no `pgExtension` in
-- drizzle-orm), so these are hand-added rather than generated
-- (db-package-scaffold/02).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gin";
--> statement-breakpoint
CREATE SCHEMA "coaching";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "nutrition";
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "training";
--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('active', 'completed', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billing_platform" AS ENUM('app_store', 'play_store', 'stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."checkin_cadence" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."checkin_status" AS ENUM('pending', 'submitted', 'reviewed', 'missed');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('invited', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."comment_target" AS ENUM('workout_session', 'set_log', 'meal', 'media_asset', 'checkin', 'program_day', 'body_metric');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'building', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('openfoodfacts', 'usda', 'coach', 'client', 'verified');--> statement-breakpoint
CREATE TYPE "public"."live_session_kind" AS ENUM('checkin_call', 'live_workout', 'group');--> statement-breakpoint
CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('video', 'image', 'audio', 'document');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('uploading', 'processing', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_visibility" AS ENUM('coach_only', 'shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."metric_source" AS ENUM('manual', 'checkin', 'coach');--> statement-breakpoint
CREATE TYPE "public"."moderation_action" AS ENUM('none', 'warning', 'content_removed', 'suspension', 'ban');--> statement-breakpoint
CREATE TYPE "public"."movement_pattern" AS ENUM('squat', 'hinge', 'push', 'pull', 'carry', 'core', 'isolation', 'other');--> statement-breakpoint
CREATE TYPE "public"."photo_angle" AS ENUM('front', 'side', 'back', 'custom');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('harassment', 'spam', 'inappropriate_content', 'impersonation', 'unsafe_advice', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'triaged', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('message', 'comment', 'media_asset', 'user');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'in_progress', 'completed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'grace', 'paused', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('starter', 'coach', 'pro', 'studio', 'agency');--> statement-breakpoint
CREATE TYPE "public"."training_goal" AS ENUM('fat_loss', 'muscle_gain', 'performance', 'health', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('coach', 'client', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."weight_unit" AS ENUM('kg', 'lb');