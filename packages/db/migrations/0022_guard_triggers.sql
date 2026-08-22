-- DB§6 / DB§8.3: blocks drift on every denormalised ownership column this
-- schema carries. One generic function, parameterised by TG_ARGV[0] (the
-- guarded column's name, passed only for the error message — the actual
-- column comparison lives in each trigger's own WHEN clause below, since
-- Postgres WHEN clauses can't be parameterised).
--
-- The bypass: `SET LOCAL app.allow_owner_change = true` inside the
-- transaction performing the documented, sanctioned client-transfer
-- procedure (phase-03-identity-and-auth/account-lifecycle/05, not yet
-- built). `SET LOCAL` (not `SET`) is what makes this safe — it reverts
-- automatically at transaction end, so a forgotten unset can't leave the
-- guard silently disabled for the rest of the session. Verified live
-- (derived-data/02's own Verification section) that a fresh
-- transaction/session has the guard back in effect without re-setting
-- anything.
CREATE OR REPLACE FUNCTION platform.reject_owner_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_owner_change', true) = 'true' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Denormalised ownership column "%" on %.% cannot be changed outside the documented client-transfer procedure (DATABASE.md DB§6). Set LOCAL app.allow_owner_change = true for that sanctioned transaction only.',
    TG_ARGV[0], TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- training.workout_sessions: client_id is the primary FK (who this
-- session belongs to, never changes); coach_id is the DB§6 duplicate,
-- derived from client_id -> client_profiles.coach_id. Guard coach_id only.
CREATE TRIGGER workout_sessions_no_owner_change BEFORE UPDATE ON training.workout_sessions
  FOR EACH ROW WHEN (OLD.coach_id IS DISTINCT FROM NEW.coach_id)
  EXECUTE FUNCTION platform.reject_owner_change('coach_id');--> statement-breakpoint
-- training.set_logs carries no coach_id column at all — client_id is the
-- sole denormalised duplicate of workout_sessions.client_id (DB§8.3's own
-- worked example).
CREATE TRIGGER set_logs_no_owner_change BEFORE UPDATE ON training.set_logs
  FOR EACH ROW WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
  EXECUTE FUNCTION platform.reject_owner_change('client_id');--> statement-breakpoint
-- nutrition.meals: same client_id-is-primary / coach_id-is-derived shape
-- as workout_sessions, per its own schema-file comment.
CREATE TRIGGER meals_no_owner_change BEFORE UPDATE ON nutrition.meals
  FOR EACH ROW WHEN (OLD.coach_id IS DISTINCT FROM NEW.coach_id)
  EXECUTE FUNCTION platform.reject_owner_change('coach_id');--> statement-breakpoint
-- coaching.media_assets is the one DB§6 table with no clear "primary FK,
-- other column derived" hierarchy — a media asset isn't strictly owned by
-- a single client the way a set_log is. Both coach_id and client_id are
-- independently used by the ownsResource authorisation check, so both are
-- guarded (derived-data/02's own task doc flags this as a decision this
-- task must make explicitly).
CREATE TRIGGER media_assets_no_coach_change BEFORE UPDATE ON coaching.media_assets
  FOR EACH ROW WHEN (OLD.coach_id IS DISTINCT FROM NEW.coach_id)
  EXECUTE FUNCTION platform.reject_owner_change('coach_id');--> statement-breakpoint
CREATE TRIGGER media_assets_no_client_change BEFORE UPDATE ON coaching.media_assets
  FOR EACH ROW WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
  EXECUTE FUNCTION platform.reject_owner_change('client_id');--> statement-breakpoint
-- coaching.comments carries no coach_id column — client_id is the sole
-- denormalised column, always resolvable regardless of target_type
-- (DB§10, coaching-schema/02).
CREATE TRIGGER comments_no_owner_change BEFORE UPDATE ON coaching.comments
  FOR EACH ROW WHEN (OLD.client_id IS DISTINCT FROM NEW.client_id)
  EXECUTE FUNCTION platform.reject_owner_change('client_id');--> statement-breakpoint
-- coaching.checkins: client_id is who the check-in belongs to (primary);
-- coach_id is derived, existing for checkins_coach_pending's query shape.
CREATE TRIGGER checkins_no_owner_change BEFORE UPDATE ON coaching.checkins
  FOR EACH ROW WHEN (OLD.coach_id IS DISTINCT FROM NEW.coach_id)
  EXECUTE FUNCTION platform.reject_owner_change('coach_id');--> statement-breakpoint
-- coaching.live_sessions: coach_id is set at creation by the coach who
-- starts the session (primary); client_id is nullable ("null for group")
-- and is who's invited, not a value derived from coach_id.
CREATE TRIGGER live_sessions_no_owner_change BEFORE UPDATE ON coaching.live_sessions
  FOR EACH ROW WHEN (OLD.coach_id IS DISTINCT FROM NEW.coach_id)
  EXECUTE FUNCTION platform.reject_owner_change('coach_id');
