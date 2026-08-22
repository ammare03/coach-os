CREATE TABLE "training"."program_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_week_id" uuid NOT NULL,
	"day_number" smallint NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"is_rest_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_days_day_number_check" CHECK ("training"."program_days"."day_number" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "training"."program_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"order_index" smallint NOT NULL,
	"target_sets" smallint NOT NULL,
	"target_reps_min" smallint,
	"target_reps_max" smallint,
	"target_rpe" numeric(3, 1),
	"target_rir" smallint,
	"target_weight_kg" numeric(6, 2),
	"target_percent_1rm" numeric(4, 1),
	"target_rest_seconds" smallint,
	"tempo" text,
	"superset_group" text,
	"alternatives" uuid[] DEFAULT '{}' NOT NULL,
	"coach_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_exercises_target_sets_check" CHECK ("training"."program_exercises"."target_sets" BETWEEN 1 AND 20),
	CONSTRAINT "program_exercises_target_reps_min_check" CHECK ("training"."program_exercises"."target_reps_min" > 0),
	CONSTRAINT "program_exercises_target_reps_max_check" CHECK ("training"."program_exercises"."target_reps_max" >= "training"."program_exercises"."target_reps_min"),
	CONSTRAINT "program_exercises_target_rpe_check" CHECK ("training"."program_exercises"."target_rpe" BETWEEN 1 AND 10),
	CONSTRAINT "program_exercises_target_rir_check" CHECK ("training"."program_exercises"."target_rir" BETWEEN 0 AND 10),
	CONSTRAINT "program_exercises_target_percent_1rm_check" CHECK ("training"."program_exercises"."target_percent_1rm" BETWEEN 1 AND 150),
	CONSTRAINT "program_exercises_tempo_check" CHECK ("training"."program_exercises"."tempo" ~ '^[0-9X]{4}$'),
	CONSTRAINT "program_exercises_superset_group_check" CHECK ("training"."program_exercises"."superset_group" ~ '^[A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "training"."program_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"week_number" smallint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_weeks_week_number_check" CHECK ("training"."program_weeks"."week_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "training"."programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_weeks" smallint NOT NULL,
	"is_template" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_duration_weeks_check" CHECK ("training"."programs"."duration_weeks" BETWEEN 1 AND 104)
);
--> statement-breakpoint
ALTER TABLE "training"."program_days" ADD CONSTRAINT "program_days_program_week_id_program_weeks_id_fk" FOREIGN KEY ("program_week_id") REFERENCES "training"."program_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."program_exercises" ADD CONSTRAINT "program_exercises_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "training"."program_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."program_exercises" ADD CONSTRAINT "program_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "training"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."program_weeks" ADD CONSTRAINT "program_weeks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "training"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."programs" ADD CONSTRAINT "programs_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_days_program_week_id_day_number_unique" ON "training"."program_days" USING btree ("program_week_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "program_exercises_program_day_id_order_index_unique" ON "training"."program_exercises" USING btree ("program_day_id","order_index");--> statement-breakpoint
CREATE INDEX "program_exercises_exercise_id_idx" ON "training"."program_exercises" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_weeks_program_id_week_number_unique" ON "training"."program_weeks" USING btree ("program_id","week_number");--> statement-breakpoint
CREATE INDEX "programs_coach_id_idx" ON "training"."programs" USING btree ("coach_id");