-- DB§8.1, transcribed exactly. Attached below to every table the Drizzle
-- schema barrel reports as having an updated_at column (derived-data/01's
-- list-updated-at-tables.ts script, not a hand-count).
--
-- NOTE on nutrition.daily_nutrition_summary: derived-data/01's own task
-- doc lists this table as deliberately excluded ("lacking updated_at"),
-- but that's stale — DATABASE.md DB§5.3's DDL genuinely gives it
-- `updated_at timestamptz NOT NULL DEFAULT now()`, and nutrition-schema/02
-- built it that way correctly. DB§8.2's "maintained by the application,
-- not by trigger" language is about the AGGREGATE VALUES (total_calories
-- etc.), never about updated_at itself — this generic housekeeping
-- trigger is orthogonal and harmless alongside recomputeDailySummary's
-- own explicit writes. Per phase-01-data-layer/README.md's own governing
-- rule ("DATABASE.md wins and the plan document is the bug"), the trigger
-- is attached here. Same reasoning applies to platform.storage_usage,
-- the other DB§8.2-named aggregate table with a real updated_at column.
CREATE OR REPLACE FUNCTION platform.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER body_metrics_updated_at BEFORE UPDATE ON coaching.body_metrics
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER checkin_templates_updated_at BEFORE UPDATE ON coaching.checkin_templates
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER checkins_updated_at BEFORE UPDATE ON coaching.checkins
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER comments_updated_at BEFORE UPDATE ON coaching.comments
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER habits_updated_at BEFORE UPDATE ON coaching.habits
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER live_sessions_updated_at BEFORE UPDATE ON coaching.live_sessions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER media_assets_updated_at BEFORE UPDATE ON coaching.media_assets
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER client_profiles_updated_at BEFORE UPDATE ON identity.client_profiles
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER coach_client_notes_updated_at BEFORE UPDATE ON identity.coach_client_notes
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER coach_profiles_updated_at BEFORE UPDATE ON identity.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON identity.devices
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER users_updated_at BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER daily_nutrition_summary_updated_at BEFORE UPDATE ON nutrition.daily_nutrition_summary
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER foods_updated_at BEFORE UPDATE ON nutrition.foods
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER meal_items_updated_at BEFORE UPDATE ON nutrition.meal_items
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER meal_plan_days_updated_at BEFORE UPDATE ON nutrition.meal_plan_days
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER meal_plan_items_updated_at BEFORE UPDATE ON nutrition.meal_plan_items
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER meal_plans_updated_at BEFORE UPDATE ON nutrition.meal_plans
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER meals_updated_at BEFORE UPDATE ON nutrition.meals
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER water_logs_updated_at BEFORE UPDATE ON nutrition.water_logs
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER storage_usage_updated_at BEFORE UPDATE ON platform.storage_usage
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER assignments_updated_at BEFORE UPDATE ON training.assignments
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER exercises_updated_at BEFORE UPDATE ON training.exercises
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER program_days_updated_at BEFORE UPDATE ON training.program_days
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER program_exercises_updated_at BEFORE UPDATE ON training.program_exercises
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER program_weeks_updated_at BEFORE UPDATE ON training.program_weeks
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER programs_updated_at BEFORE UPDATE ON training.programs
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER set_logs_updated_at BEFORE UPDATE ON training.set_logs
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER workout_sessions_updated_at BEFORE UPDATE ON training.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
