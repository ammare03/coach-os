CREATE TABLE "identity"."coach_client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"invite_role" text DEFAULT 'client' NOT NULL,
	"email" "citext" NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_code_unique" UNIQUE("code"),
	CONSTRAINT "invites_invite_role_check" CHECK ("identity"."invites"."invite_role" IN ('client', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "identity"."coach_client_notes" ADD CONSTRAINT "coach_client_notes_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."coach_client_notes" ADD CONSTRAINT "coach_client_notes_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invites" ADD CONSTRAINT "invites_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invites" ADD CONSTRAINT "invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_client_notes_coach_id_idx" ON "identity"."coach_client_notes" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "coach_client_notes_client_id_idx" ON "identity"."coach_client_notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invites_pending" ON "identity"."invites" USING btree ("coach_id") WHERE "identity"."invites"."accepted_at" IS NULL AND "identity"."invites"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invites_coach_id_idx" ON "identity"."invites" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "invites_accepted_by_user_id_idx" ON "identity"."invites" USING btree ("accepted_by_user_id");