DROP INDEX "job_action_user_job_idx";--> statement-breakpoint
ALTER TABLE "job" DROP COLUMN "userId";--> statement-breakpoint
ALTER TABLE "job_action" DROP COLUMN "userId";--> statement-breakpoint
CREATE UNIQUE INDEX "job_action_job_id_idx" ON "job_action" ("jobId");