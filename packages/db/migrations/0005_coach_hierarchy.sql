ALTER TABLE "identity"."coach_profiles" ADD COLUMN "parent_coach_id" uuid;--> statement-breakpoint
ALTER TABLE "identity"."coach_profiles" ADD CONSTRAINT "coach_profiles_parent_coach_id_coach_profiles_id_fk" FOREIGN KEY ("parent_coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_profiles_parent" ON "identity"."coach_profiles" USING btree ("parent_coach_id") WHERE "identity"."coach_profiles"."deleted_at" IS NULL AND "identity"."coach_profiles"."parent_coach_id" IS NOT NULL;--> statement-breakpoint
-- DB§8.3's guard trigger. Not declarable through Drizzle's schema (there is
-- no trigger/function API in drizzle-orm), so hand-added here, same as
-- db-package-scaffold/02's CREATE EXTENSION statements. Two independent
-- conditions, neither substitutes for the other:
--   A. the REFERENCED parent already has a parent of its own -> rejects a
--      new row trying to become a third level.
--   B. THIS row is already referenced as someone else's parent_coach_id ->
--      rejects an existing root with live assistants being updated to
--      point at someone else.
-- Distinguishable RAISE EXCEPTION messages per branch (identity-schema/05
-- §Approach 4) so a support investigation doesn't need to read the trigger
-- source to know which one fired.
CREATE FUNCTION identity.reject_multi_level_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grandparent_id uuid;
  is_already_a_parent boolean;
BEGIN
  SELECT parent_coach_id INTO grandparent_id
    FROM identity.coach_profiles
    WHERE id = NEW.parent_coach_id;

  IF grandparent_id IS NOT NULL THEN
    RAISE EXCEPTION 'cannot delegate under an assistant';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM identity.coach_profiles WHERE parent_coach_id = NEW.id
  ) INTO is_already_a_parent;

  IF is_already_a_parent THEN
    RAISE EXCEPTION 'a coach with assistants cannot itself become an assistant';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER coach_profiles_single_level_hierarchy BEFORE INSERT OR UPDATE ON identity.coach_profiles
  FOR EACH ROW WHEN (NEW.parent_coach_id IS NOT NULL)
  EXECUTE FUNCTION identity.reject_multi_level_hierarchy();