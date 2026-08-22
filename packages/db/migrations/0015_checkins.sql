CREATE TABLE "coaching"."checkin_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cadence" "checkin_cadence" DEFAULT 'weekly' NOT NULL,
	"due_weekday" smallint,
	"fields" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_templates_due_weekday_check" CHECK ("coaching"."checkin_templates"."due_weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "coaching"."checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"template_id" uuid,
	"template_snapshot" jsonb NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "checkin_status" DEFAULT 'pending' NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_responses" jsonb,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"coach_summary" text,
	"coach_video_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_period" CHECK ("coaching"."checkins"."period_end" >= "coaching"."checkins"."period_start")
);
--> statement-breakpoint
ALTER TABLE "coaching"."checkin_templates" ADD CONSTRAINT "checkin_templates_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."checkins" ADD CONSTRAINT "checkins_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."checkins" ADD CONSTRAINT "checkins_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."checkins" ADD CONSTRAINT "checkins_template_id_checkin_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "coaching"."checkin_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."checkins" ADD CONSTRAINT "checkins_coach_video_asset_id_media_assets_id_fk" FOREIGN KEY ("coach_video_asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkins_client_period_unique" ON "coaching"."checkins" USING btree ("client_id","period_start");--> statement-breakpoint
CREATE INDEX "checkins_coach_pending" ON "coaching"."checkins" USING btree ("coach_id","period_end") WHERE "coaching"."checkins"."status" IN ('pending', 'submitted');