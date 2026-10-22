CREATE TABLE "candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"headline" text,
	"summary" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT '' NOT NULL,
	"experience" jsonb DEFAULT '[]' NOT NULL,
	"skills" jsonb DEFAULT '[]' NOT NULL,
	"technologies" jsonb DEFAULT '[]' NOT NULL,
	"education" jsonb DEFAULT '[]' NOT NULL,
	"languages" jsonb DEFAULT '[]' NOT NULL,
	"cvUrl" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" text DEFAULT 'single-user' NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"isRemote" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"postedAt" timestamp with time zone,
	"salaryMin" integer,
	"salaryMax" integer,
	"salaryCurrency" text,
	"postingUrl" text,
	"fingerprint" text NOT NULL,
	"sourceJobCount" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" text DEFAULT 'single-user' NOT NULL,
	"jobId" uuid NOT NULL,
	"status" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_action_status_check" CHECK ("status" IN ('saved', 'applied', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE "job_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"candidateId" uuid NOT NULL,
	"desiredRoles" jsonb DEFAULT '[]' NOT NULL,
	"locations" jsonb DEFAULT '[]' NOT NULL,
	"workModes" jsonb DEFAULT '[]' NOT NULL,
	"salaryMin" integer,
	"salaryMax" integer,
	"salaryCurrency" text DEFAULT 'USD',
	"preferredTechnologies" jsonb DEFAULT '[]' NOT NULL,
	"exclusionPatterns" jsonb DEFAULT '[]' NOT NULL,
	"positionLevels" jsonb DEFAULT '[]' NOT NULL,
	"minMatchScore" integer DEFAULT 75 NOT NULL,
	"hideUndisclosedSalary" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL,
	"name" text NOT NULL,
	"integrationType" text NOT NULL,
	"lastSyncedAt" timestamp with time zone,
	CONSTRAINT "job_source_integration_type_check" CHECK ("integrationType" IN ('api', 'scraper', 'upload'))
);
--> statement-breakpoint
CREATE TABLE "match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"candidateId" uuid NOT NULL,
	"jobId" uuid NOT NULL,
	"score" integer NOT NULL,
	"matchedSignals" jsonb DEFAULT '[]' NOT NULL,
	"missingSignals" jsonb DEFAULT '[]' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusionReasons" jsonb DEFAULT '[]' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"computedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"jobId" uuid NOT NULL,
	"sourceId" uuid NOT NULL,
	"externalId" text NOT NULL,
	"raw" jsonb NOT NULL,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_fingerprint_idx" ON "job" ("fingerprint");--> statement-breakpoint
CREATE INDEX "job_posted_at_idx" ON "job" ("postedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "job_action_user_job_idx" ON "job_action" ("userId","jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "job_profile_candidate_id_idx" ON "job_profile" ("candidateId");--> statement-breakpoint
CREATE UNIQUE INDEX "job_source_key_idx" ON "job_source" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "match_candidate_job_idx" ON "match" ("candidateId","jobId");--> statement-breakpoint
CREATE INDEX "match_job_id_idx" ON "match" ("jobId");--> statement-breakpoint
CREATE UNIQUE INDEX "source_job_source_external_idx" ON "source_job" ("sourceId","externalId");--> statement-breakpoint
CREATE INDEX "source_job_job_id_idx" ON "source_job" ("jobId");--> statement-breakpoint
ALTER TABLE "job_action" ADD CONSTRAINT "job_action_jobId_job_id_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "job_profile" ADD CONSTRAINT "job_profile_candidateId_candidate_id_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidate"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_candidateId_candidate_id_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidate"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_jobId_job_id_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_job" ADD CONSTRAINT "source_job_jobId_job_id_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_job" ADD CONSTRAINT "source_job_sourceId_job_source_id_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_source"("id") ON DELETE CASCADE;