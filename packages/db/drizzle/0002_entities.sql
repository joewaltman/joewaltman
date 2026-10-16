CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"dba" text,
	"normalized_dba" text,
	"entity_type" text,
	"status" text,
	"formed_at" date,
	"address1" text,
	"address2" text,
	"city" text,
	"state" text,
	"zip" text,
	"zip_cluster" text,
	"county" text,
	"naics" text,
	"category" text,
	"website" text,
	"phone" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"source_url" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "entity_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_events" ADD CONSTRAINT "entity_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_name_zip" ON "entities" USING btree ("normalized_name","zip");--> statement-breakpoint
CREATE INDEX "entities_dba_zip" ON "entities" USING btree ("normalized_dba","zip");--> statement-breakpoint
CREATE INDEX "entities_county" ON "entities" USING btree ("county");--> statement-breakpoint
CREATE INDEX "entities_created" ON "entities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "entity_events_entity_date" ON "entity_events" USING btree ("entity_id","event_date");--> statement-breakpoint
CREATE INDEX "entity_events_type_created" ON "entity_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_identifiers_source_id" ON "entity_identifiers" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "entity_identifiers_entity" ON "entity_identifiers" USING btree ("entity_id");