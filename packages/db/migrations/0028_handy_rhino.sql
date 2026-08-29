ALTER TABLE "identity"."client_profiles" ADD COLUMN "coach_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD COLUMN "history_shared_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD COLUMN "metrics_shared_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD COLUMN "nutrition_shared_from" timestamp with time zone;