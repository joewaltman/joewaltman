CREATE TABLE "hts_rates" (
	"hts_number" text PRIMARY KEY NOT NULL,
	"description" text,
	"general_rate_text" text,
	"ad_valorem_pct" double precision,
	"source_url" text NOT NULL,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prerun_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool" text NOT NULL,
	"subject" text NOT NULL,
	"url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prerun_notes_tool_created" ON "prerun_notes" USING btree ("tool","created_at");