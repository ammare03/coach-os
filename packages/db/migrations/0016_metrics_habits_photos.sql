CREATE TABLE "coaching"."body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_date" date NOT NULL,
	"weight_kg" numeric(5, 2),
	"body_fat_pct" numeric(4, 1),
	"waist_cm" numeric(5, 1),
	"hip_cm" numeric(5, 1),
	"chest_cm" numeric(5, 1),
	"arm_cm" numeric(5, 1),
	"thigh_cm" numeric(5, 1),
	"neck_cm" numeric(5, 1),
	"source" "metric_source" DEFAULT 'manual' NOT NULL,
	"checkin_id" uuid,
	"client_local_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_metrics_weight_kg_check" CHECK ("coaching"."body_metrics"."weight_kg" BETWEEN 20 AND 400),
	CONSTRAINT "body_metrics_body_fat_pct_check" CHECK ("coaching"."body_metrics"."body_fat_pct" BETWEEN 1 AND 70)
);
--> statement-breakpoint
CREATE TABLE "coaching"."habit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"habit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"completed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coaching"."habits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"target_per_week" smallint DEFAULT 7 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_target_per_week_check" CHECK ("coaching"."habits"."target_per_week" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "coaching"."progress_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"angle" "photo_angle" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"checkin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coaching"."body_metrics" ADD CONSTRAINT "body_metrics_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."body_metrics" ADD CONSTRAINT "body_metrics_checkin_id_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "coaching"."checkins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."habit_logs" ADD CONSTRAINT "habit_logs_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "coaching"."habits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."habits" ADD CONSTRAINT "habits_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."habits" ADD CONSTRAINT "habits_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."progress_photos" ADD CONSTRAINT "progress_photos_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."progress_photos" ADD CONSTRAINT "progress_photos_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "coaching"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coaching"."progress_photos" ADD CONSTRAINT "progress_photos_checkin_id_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "coaching"."checkins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_metrics_client_date" ON "coaching"."body_metrics" USING btree ("client_id","recorded_date" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "habit_logs_habit_date_unique" ON "coaching"."habit_logs" USING btree ("habit_id","date");