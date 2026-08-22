CREATE TABLE "nutrition"."meal_plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_plan_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition"."meal_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_plan_id" uuid NOT NULL,
	"day_number" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plan_days_day_number_check" CHECK ("nutrition"."meal_plan_days"."day_number" BETWEEN 1 AND 7)
);
--> statement-breakpoint
CREATE TABLE "nutrition"."meal_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_plan_day_id" uuid NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"food_id" uuid,
	"custom_name" text,
	"quantity_g" numeric(8, 2) NOT NULL,
	"order_index" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition"."meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_template" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition"."water_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"logged_date" date NOT NULL,
	"amount_ml" integer NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_local_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "water_logs_amount_ml_check" CHECK ("nutrition"."water_logs"."amount_ml" > 0)
);
--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plan_assignments" ADD CONSTRAINT "meal_plan_assignments_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "nutrition"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plan_assignments" ADD CONSTRAINT "meal_plan_assignments_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plan_days" ADD CONSTRAINT "meal_plan_days_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "nutrition"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plan_items" ADD CONSTRAINT "meal_plan_items_meal_plan_day_id_meal_plan_days_id_fk" FOREIGN KEY ("meal_plan_day_id") REFERENCES "nutrition"."meal_plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plan_items" ADD CONSTRAINT "meal_plan_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "nutrition"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."meal_plans" ADD CONSTRAINT "meal_plans_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition"."water_logs" ADD CONSTRAINT "water_logs_client_id_client_profiles_id_fk" FOREIGN KEY ("client_id") REFERENCES "identity"."client_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_plan_assignments_meal_plan_id_idx" ON "nutrition"."meal_plan_assignments" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plan_assignments_client_id_idx" ON "nutrition"."meal_plan_assignments" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_days_meal_plan_id_day_number_unique" ON "nutrition"."meal_plan_days" USING btree ("meal_plan_id","day_number");--> statement-breakpoint
CREATE INDEX "meal_plan_items_meal_plan_day_id_idx" ON "nutrition"."meal_plan_items" USING btree ("meal_plan_day_id");--> statement-breakpoint
CREATE INDEX "meal_plan_items_food_id_idx" ON "nutrition"."meal_plan_items" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "meal_plans_coach_id_idx" ON "nutrition"."meal_plans" USING btree ("coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "water_logs_client_id_client_local_id_unique" ON "nutrition"."water_logs" USING btree ("client_id","client_local_id");