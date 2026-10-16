CREATE TABLE "manual_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"rows_kept" integer NOT NULL,
	"rows_seen" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "manual_drops_status" ON "manual_drops" USING btree ("status","uploaded_at");