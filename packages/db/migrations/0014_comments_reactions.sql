CREATE TABLE "coaching"."comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" uuid NOT NULL,
	"target_type" "comment_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text,
	"voice_note_asset_id" uuid,
	"video_reply_asset_id" uuid,
	"timestamp_ms" integer,
	"annotation" jsonb,
	"parent_comment_id" uuid,
	"is_ai_generated" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_has_content" CHECK ("coaching"."comments"."body" IS NOT NULL OR "coaching"."comments"."voice_note_asset_id" IS NOT NULL OR "coaching"."comments"."video_reply_asset_id" IS NOT NULL OR "coaching"."comments"."annotation" IS NOT NULL),
	CONSTRAINT "comments_timestamp_ms_check" CHECK ("coaching"."comments"."timestamp_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coaching"."reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" "comment_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coaching"."comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."comments" ADD CONSTRAINT "comments_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."comments" ADD CONSTRAINT "comments_voice_note_asset_id_media_assets_id_fk" FOREIGN KEY ("voice_note_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."comments" ADD CONSTRAINT "comments_video_reply_asset_id_media_assets_id_fk" FOREIGN KEY ("video_reply_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."comments" ADD CONSTRAINT "comments_parent_comment_id_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "coaching"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_target" ON "coaching"."comments" USING btree ("target_type","target_id","created_at" DESC NULLS LAST) WHERE "coaching"."comments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "comments_client_unread" ON "coaching"."comments" USING btree ("client_id","created_at" DESC NULLS LAST) WHERE "coaching"."comments"."read_at" IS NULL AND "coaching"."comments"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_user_target_emoji_unique" ON "coaching"."reactions" USING btree ("user_id","target_type","target_id","emoji");