CREATE TABLE "coaching"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching"."live_session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"live_session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coaching"."live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"client_id" uuid,
	"room_name" text NOT NULL,
	"kind" "live_session_kind" NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"participant_minutes" integer DEFAULT 0 NOT NULL,
	"recording_asset_id" uuid,
	"coach_consent_at" timestamp with time zone,
	"client_consent_at" timestamp with time zone,
	"workout_session_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_sessions_room_name_unique" UNIQUE("room_name"),
	CONSTRAINT "recording_requires_dual_consent" CHECK ("coaching"."live_sessions"."recording_asset_id" IS NULL OR ("coaching"."live_sessions"."coach_consent_at" IS NOT NULL AND "coaching"."live_sessions"."client_consent_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "coaching"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" text,
	"attachment_asset_id" uuid,
	"linked_target_type" "comment_target",
	"linked_target_id" uuid,
	"client_local_id" text NOT NULL,
	"read_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_has_content" CHECK ("coaching"."messages"."body" IS NOT NULL OR "coaching"."messages"."attachment_asset_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "coaching"."conversations" ADD CONSTRAINT "conversations_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."conversations" ADD CONSTRAINT "conversations_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_session_participants" ADD CONSTRAINT "live_session_participants_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "coaching"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_session_participants" ADD CONSTRAINT "live_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_sessions" ADD CONSTRAINT "live_sessions_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_sessions" ADD CONSTRAINT "live_sessions_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_sessions" ADD CONSTRAINT "live_sessions_recording_asset_id_media_assets_id_fk" FOREIGN KEY ("recording_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."live_sessions" ADD CONSTRAINT "live_sessions_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "training"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "coaching"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."messages" ADD CONSTRAINT "messages_attachment_asset_id_media_assets_id_fk" FOREIGN KEY ("attachment_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_coach_client_unique" ON "coaching"."conversations" USING btree ("coach_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_session_participants_unique" ON "coaching"."live_session_participants" USING btree ("live_session_id","user_id","joined_at");--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "coaching"."messages" USING btree ("conversation_id","created_at" DESC NULLS LAST) WHERE "coaching"."messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_local" ON "coaching"."messages" USING btree ("sender_user_id","client_local_id");