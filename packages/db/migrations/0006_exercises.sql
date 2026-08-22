-- Hand-added — Drizzle has no primitive for standalone SQL functions, so this
-- doesn't come out of `db:generate`. Required by `search_vector` below:
-- DB§5.2's literal generated-column expression calls `array_to_string`
-- directly, but that built-in is STABLE (see `pg_proc.provolatile`), and
-- Postgres rejects any non-immutable function in a generated column's
-- expression with "generation expression is not immutable" — verified
-- against this exact expression, not a hypothetical. This wrapper produces
-- byte-for-byte the same output for every input and is declared IMMUTABLE,
-- which Postgres accepts on trust for a hand-written function (it does not,
-- and cannot, verify the claim by inspecting the body). A genuine DATABASE.md
-- DDL bug, fixed here per CLAUDE.md §0 (training-schema/01).
CREATE FUNCTION training.immutable_array_to_string(text[], text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
  $$ SELECT array_to_string($1, $2) $$;
--> statement-breakpoint
CREATE TABLE "training"."exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coach_id" uuid,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscles" text[] DEFAULT '{}' NOT NULL,
	"equipment" text NOT NULL,
	"movement_pattern" "movement_pattern" NOT NULL,
	"demo_asset_id" uuid,
	"cues" text[] DEFAULT '{}' NOT NULL,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	"is_bodyweight" boolean DEFAULT false NOT NULL,
	"default_increment_kg" numeric(4, 2) DEFAULT '2.5',
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, name || ' ' || training.immutable_array_to_string(aliases,' '))) STORED,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training"."exercises" ADD CONSTRAINT "exercises_coach_id_coach_profiles_id_fk" FOREIGN KEY ("coach_id") REFERENCES "identity"."coach_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_coach_name" ON "training"."exercises" USING btree (coalesce("coach_id", '00000000-0000-0000-0000-000000000000'),lower("name")) WHERE "training"."exercises"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exercises_search" ON "training"."exercises" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "exercises_trgm" ON "training"."exercises" USING gin ("name" gin_trgm_ops);