CREATE TABLE "platform"."metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric" text NOT NULL,
	"value" numeric NOT NULL,
	"dimensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "metric_samples_metric_time" ON "platform"."metric_samples" USING btree ("metric","sampled_at" DESC NULLS LAST);