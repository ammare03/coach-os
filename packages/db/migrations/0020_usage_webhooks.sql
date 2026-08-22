CREATE TABLE "platform"."feature_usage" (
	"coach_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"live_minutes" integer DEFAULT 0 NOT NULL,
	"ai_generations" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "feature_usage_coach_id_period_start_pk" PRIMARY KEY("coach_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "platform"."storage_usage" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"bytes_used" bigint DEFAULT 0 NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."feature_usage" ADD CONSTRAINT "feature_usage_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."storage_usage" ADD CONSTRAINT "storage_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_unique" ON "platform"."webhook_events" USING btree ("provider","event_id");