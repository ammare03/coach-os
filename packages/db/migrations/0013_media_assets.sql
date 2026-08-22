CREATE TABLE "coaching"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"coach_id" uuid,
	"client_id" uuid,
	"kind" "media_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_seconds" numeric(8, 2),
	"width" integer,
	"height" integer,
	"orientation" smallint,
	"thumbnail_key" text,
	"blurhash" text,
	"playback_id" text,
	"processing_status" "media_status" DEFAULT 'uploading' NOT NULL,
	"processing_error" text,
	"visibility" "media_visibility" DEFAULT 'coach_only' NOT NULL,
	"exercise_id" uuid,
	"workout_session_id" uuid,
	"set_log_id" uuid,
	"expires_at" timestamp with time zone,
	"retention_warned_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_assets_size_bytes_check" CHECK ("coaching"."media_assets"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "training"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "training"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."media_assets" ADD CONSTRAINT "media_assets_set_log_id_set_logs_id_fk" FOREIGN KEY ("set_log_id") REFERENCES "training"."set_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_owner_status" ON "coaching"."media_assets" USING btree ("owner_user_id","processing_status");--> statement-breakpoint
CREATE INDEX "media_coach_unreviewed" ON "coaching"."media_assets" USING btree ("coach_id","created_at" DESC NULLS LAST) WHERE "coaching"."media_assets"."processing_status" = 'ready' AND "coaching"."media_assets"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "media_expiring" ON "coaching"."media_assets" USING btree ("expires_at") WHERE "coaching"."media_assets"."expires_at" IS NOT NULL AND "coaching"."media_assets"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "identity"."coach_profiles" ADD CONSTRAINT "coach_profiles_brand_logo_asset_id_media_assets_id_fk" FOREIGN KEY ("brand_logo_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_avatar_asset_id_media_assets_id_fk" FOREIGN KEY ("avatar_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."exercises" ADD CONSTRAINT "exercises_demo_asset_id_media_assets_id_fk" FOREIGN KEY ("demo_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meals" ADD CONSTRAINT "meals_photo_asset_id_media_assets_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;