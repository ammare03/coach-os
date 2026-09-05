CREATE TABLE "identity"."medical_disclaimer_acknowledgements" (
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_disclaimer_acknowledgements_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "identity"."medical_disclaimer_acknowledgements" ADD CONSTRAINT "medical_disclaimer_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;