ALTER TABLE "identity"."client_profiles" ALTER COLUMN "coach_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD COLUMN "former_coach_id" uuid;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."deletion_requests" ADD COLUMN "coach_clients_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."client_profiles" ADD CONSTRAINT "client_profiles_former_coach_id_coach_profiles_id_fk" FOREIGN KEY ("former_coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_profiles_former_coach" ON "identity"."client_profiles" USING btree ("former_coach_id","detached_at") WHERE "identity"."client_profiles"."former_coach_id" IS NOT NULL;