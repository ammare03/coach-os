CREATE TABLE "training"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"current_week" smallint DEFAULT 1 NOT NULL,
	"status" "assignment_status" DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training"."workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"assignment_id" uuid,
	"program_day_id" uuid,
	"name" text,
	"scheduled_date" date NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_seconds" integer,
	"perceived_exertion" smallint,
	"client_notes" text,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"skip_reason" text,
	"total_volume_kg" numeric(10, 2),
	"reviewed_at" timestamp with time zone,
	"client_local_id" text,
	"active_device_id" text,
	"claimed_at" timestamp with time zone,
	"program_snapshot" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_completion" CHECK ("training"."workout_sessions"."status" <> 'completed' OR ("training"."workout_sessions"."started_at" IS NOT NULL AND "training"."workout_sessions"."completed_at" IS NOT NULL)),
	CONSTRAINT "session_skip_reason" CHECK ("training"."workout_sessions"."status" <> 'skipped' OR "training"."workout_sessions"."skip_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "training"."assignments" ADD CONSTRAINT "assignments_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "training"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."assignments" ADD CONSTRAINT "assignments_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."assignments" ADD CONSTRAINT "assignments_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."workout_sessions" ADD CONSTRAINT "workout_sessions_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."workout_sessions" ADD CONSTRAINT "workout_sessions_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."workout_sessions" ADD CONSTRAINT "workout_sessions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "training"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training"."workout_sessions" ADD CONSTRAINT "workout_sessions_program_day_id_program_days_id_fk" FOREIGN KEY ("program_day_id") REFERENCES "training"."program_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_one_active" ON "training"."assignments" USING btree ("client_id") WHERE "training"."assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "assignments_program_id_idx" ON "training"."assignments" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "assignments_client_id_idx" ON "training"."assignments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "assignments_coach_id_idx" ON "training"."assignments" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_client_local" ON "training"."workout_sessions" USING btree ("client_id","client_local_id") WHERE "training"."workout_sessions"."client_local_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_client_day_unique" ON "training"."workout_sessions" USING btree ("client_id","program_day_id","scheduled_date") WHERE "training"."workout_sessions"."program_day_id" IS NOT NULL AND "training"."workout_sessions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workout_sessions_client_id_idx" ON "training"."workout_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_coach_id_idx" ON "training"."workout_sessions" USING btree ("coach_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_assignment_id_idx" ON "training"."workout_sessions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_program_day_id_idx" ON "training"."workout_sessions" USING btree ("program_day_id");