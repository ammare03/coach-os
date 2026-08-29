CREATE TABLE "platform"."export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"format_version" smallint DEFAULT 1 NOT NULL,
	"bytes" bigint,
	"row_counts" jsonb,
	"object_key" text,
	"expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform"."export_requests" ADD CONSTRAINT "export_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."export_requests" ADD CONSTRAINT "export_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_requests_active" ON "platform"."export_requests" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "platform"."export_requests"."status" IN ('queued', 'building');