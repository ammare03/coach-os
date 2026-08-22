CREATE TABLE "identity"."auth_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_uid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_providers_provider_check" CHECK ("identity"."auth_providers"."provider" IN ('apple', 'google'))
);
--> statement-breakpoint
CREATE TABLE "identity"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expo_push_token" text,
	"platform" text NOT NULL,
	"app_version" text,
	"os_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_platform_check" CHECK ("identity"."devices"."platform" IN ('ios', 'android', 'web'))
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text,
	"name" text NOT NULL,
	"avatar_asset_id" uuid,
	"role" "user_role" NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"onboarding_completed_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"analytics_opt_out" boolean DEFAULT false NOT NULL,
	"ai_processing_opt_out" boolean DEFAULT false NOT NULL,
	"weight_unit" "weight_unit" DEFAULT 'kg' NOT NULL,
	"date_of_birth" date,
	"is_minor" boolean DEFAULT false NOT NULL,
	"guardian_email" "citext",
	"guardian_consent_at" timestamp with time zone,
	"nominee_name" text,
	"nominee_email" "citext",
	"internal_operator" boolean DEFAULT false NOT NULL,
	"suspended_until" timestamp with time zone,
	"banned_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_or_social" CHECK ("identity"."users"."password_hash" IS NOT NULL OR "identity"."users"."email_verified_at" IS NOT NULL),
	CONSTRAINT "users_minor_is_client" CHECK (NOT "identity"."users"."is_minor" OR "identity"."users"."role" = 'client'),
	CONSTRAINT "users_minor_has_guardian" CHECK (NOT "identity"."users"."is_minor" OR "identity"."users"."guardian_email" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "identity"."auth_providers" ADD CONSTRAINT "auth_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_providers_provider_uid_unique" ON "identity"."auth_providers" USING btree ("provider","provider_uid");--> statement-breakpoint
CREATE INDEX "auth_providers_user_id_idx" ON "identity"."auth_providers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_id_expo_push_token_unique" ON "identity"."devices" USING btree ("user_id","expo_push_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "identity"."users" USING btree ("email") WHERE "identity"."users"."deleted_at" IS NULL;