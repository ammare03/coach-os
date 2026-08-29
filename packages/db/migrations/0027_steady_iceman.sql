ALTER TABLE "training"."workout_sessions" ALTER COLUMN "coach_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nutrition"."meals" ALTER COLUMN "coach_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "coaching"."checkins" ALTER COLUMN "coach_id" DROP NOT NULL;