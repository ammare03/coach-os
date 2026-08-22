CREATE TABLE "nutrition"."daily_nutrition_summary" (
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"total_calories" numeric(8, 2) DEFAULT '0' NOT NULL,
	"total_protein_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"total_carbs_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"total_fat_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"target_calories" integer,
	"target_protein_g" integer,
	"adherence_score" numeric(4, 1),
	"water_ml" integer DEFAULT 0 NOT NULL,
	"meals_logged" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_nutrition_summary_client_id_date_pk" PRIMARY KEY("client_id","date")
);
--> statement-breakpoint
CREATE TABLE "nutrition"."meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"food_id" uuid,
	"custom_name" text,
	"quantity_g" numeric(8, 2) NOT NULL,
	"calories" numeric(8, 2) NOT NULL,
	"protein_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"carbs_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"fat_g" numeric(7, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_quantity_g_check" CHECK ("nutrition"."meal_items"."quantity_g" > 0),
	CONSTRAINT "item_identified" CHECK ("nutrition"."meal_items"."food_id" IS NOT NULL OR "nutrition"."meal_items"."custom_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "nutrition"."meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"coach_id" uuid NOT NULL,
	"logged_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"photo_asset_id" uuid,
	"client_local_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nutrition"."daily_nutrition_summary" ADD CONSTRAINT "daily_nutrition_summary_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "nutrition"."meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "nutrition"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meals" ADD CONSTRAINT "meals_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meals" ADD CONSTRAINT "meals_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_items_meal_id_idx" ON "nutrition"."meal_items" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meal_items_food_id_idx" ON "nutrition"."meal_items" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_client_local" ON "nutrition"."meals" USING btree ("client_id","client_local_id");--> statement-breakpoint
CREATE INDEX "meals_coach_id_idx" ON "nutrition"."meals" USING btree ("coach_id");