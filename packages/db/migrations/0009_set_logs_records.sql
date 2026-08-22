CREATE TABLE "training"."personal_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"set_log_id" uuid,
	"achieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_records_record_type_check" CHECK ("training"."personal_records"."record_type" IN ('1rm_estimated', 'max_weight', 'max_reps', 'max_volume'))
);
--> statement-breakpoint
CREATE TABLE "training"."set_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"set_number" smallint NOT NULL,
	"reps" smallint,
	"weight_kg" numeric(6, 2),
	"rpe" numeric(3, 1),
	"rir" smallint,
	"duration_seconds" integer,
	"distance_m" numeric(8, 2),
	"is_warmup" boolean DEFAULT false NOT NULL,
	"is_failure" boolean DEFAULT false NOT NULL,
	"notes" text,
	"estimated_1rm_kg" numeric(6, 2),
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_local_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_has_measurement" CHECK ("training"."set_logs"."reps" IS NOT NULL OR "training"."set_logs"."duration_seconds" IS NOT NULL OR "training"."set_logs"."distance_m" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "training"."personal_records" ADD CONSTRAINT "personal_records_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."personal_records" ADD CONSTRAINT "personal_records_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "training"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."personal_records" ADD CONSTRAINT "personal_records_set_log_id_set_logs_id_fk" FOREIGN KEY ("set_log_id") REFERENCES "training"."set_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."set_logs" ADD CONSTRAINT "set_logs_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "training"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."set_logs" ADD CONSTRAINT "set_logs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "training"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."set_logs" ADD CONSTRAINT "set_logs_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_records_client_id_exercise_id_record_type_unique" ON "training"."personal_records" USING btree ("client_id","exercise_id","record_type");--> statement-breakpoint
CREATE INDEX "personal_records_exercise_id_idx" ON "training"."personal_records" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "personal_records_set_log_id_idx" ON "training"."personal_records" USING btree ("set_log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "set_logs_client_local" ON "training"."set_logs" USING btree ("client_id","client_local_id");--> statement-breakpoint
CREATE INDEX "set_logs_client_exercise" ON "training"."set_logs" USING btree ("client_id","exercise_id","logged_at" DESC NULLS LAST) WHERE "training"."set_logs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "set_logs_session" ON "training"."set_logs" USING btree ("workout_session_id","set_number");--> statement-breakpoint
CREATE INDEX "set_logs_exercise_id_idx" ON "training"."set_logs" USING btree ("exercise_id");