CREATE TABLE "identity"."deletion_requests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_purge_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."deletion_requests" ADD CONSTRAINT "deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;