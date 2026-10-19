CREATE TABLE "job_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"run_id" uuid,
	"status" text
);
--> statement-breakpoint
CREATE INDEX "job_requests_pending" ON "job_requests" USING btree ("started_at","requested_at");