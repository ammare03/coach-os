CREATE TABLE "platform"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_time" ON "platform"."audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Hand-added: Drizzle's schema builder has no first-class representation
-- for Postgres RULEs (DATABASE.md DB§8.3, platform-schema/02's own task
-- doc). DO INSTEAD NOTHING means an UPDATE/DELETE against this table
-- reports success and changes nothing — it does NOT raise an error. This
-- is the entire mechanism behind the append-only guarantee CLAUDE.md
-- §21.2 depends on; verify both rules are present after every future
-- migration touching this table, since a missing rule here is silent.
--
-- BUG FIX (found live during this task's own Verification step, not a
-- transcription error — DATABASE.md's DB§5.5 and DB§8.3 genuinely
-- conflict as originally written): DB§5.5 gives actor_user_id
-- `ON DELETE SET NULL`, and DB§19.2 step 6 requires that same nulling
-- during account purge. Both mechanisms are themselves an UPDATE against
-- this table. An UNCONDITIONAL audit_log_no_update rule (as first
-- transcribed) blocks that UPDATE too — confirmed live: deleting the
-- referenced user throws "referential integrity query ... gave
-- unexpected result" because Postgres detects the rule silently
-- rewrote the FK's internal nulling UPDATE into a no-op. Fixed by
-- scoping the rule's WHERE clause to exempt exactly one shape of update:
-- actor_user_id transitioning non-null -> null with every other column
-- unchanged. Anything else — any attempt to edit action, target_type,
-- target_id, ip, user_agent, metadata, or created_at, or to set
-- actor_user_id to anything other than NULL — is still silently blocked.
CREATE RULE audit_log_no_update AS ON UPDATE TO "platform"."audit_log"
  WHERE NOT (
    OLD.actor_user_id IS NOT NULL
    AND NEW.actor_user_id IS NULL
    AND NEW.action = OLD.action
    AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
    AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND NEW.ip IS NOT DISTINCT FROM OLD.ip
    AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
    AND NEW.metadata = OLD.metadata
    AND NEW.created_at = OLD.created_at
  )
  DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO "platform"."audit_log" DO INSTEAD NOTHING;