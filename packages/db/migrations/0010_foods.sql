CREATE TABLE "nutrition"."foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "food_source" NOT NULL,
	"external_id" text,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"created_by_user_id" uuid,
	"serving_size_g" numeric(7, 2),
	"serving_label" text,
	"calories_per_100g" numeric(7, 2) NOT NULL,
	"protein_g" numeric(6, 2) DEFAULT '0' NOT NULL,
	"carbs_g" numeric(6, 2) DEFAULT '0' NOT NULL,
	"fat_g" numeric(6, 2) DEFAULT '0' NOT NULL,
	"fiber_g" numeric(6, 2),
	"sugar_g" numeric(6, 2),
	"sodium_mg" numeric(8, 2),
	"is_verified" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(brand,'') || ' ' || name)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_calories_per_100g_check" CHECK ("nutrition"."foods"."calories_per_100g" >= 0)
);
--> statement-breakpoint
ALTER TABLE "nutrition"."foods" ADD CONSTRAINT "foods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "foods_source_external_id_unique" ON "nutrition"."foods" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "foods_barcode" ON "nutrition"."foods" USING btree ("barcode") WHERE "nutrition"."foods"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "foods_search" ON "nutrition"."foods" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "foods_trgm" ON "nutrition"."foods" USING gin ("name" gin_trgm_ops);