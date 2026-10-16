CREATE TABLE "match_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_item_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"confidence" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recap_searches" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"last_searched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"raw_name" text NOT NULL,
	"city" text,
	"state" text,
	"entity_id" uuid,
	"match_status" text NOT NULL,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watchlist_mutes" (
	"watchlist_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_subscriber_id_unique" UNIQUE("subscriber_id")
);
--> statement-breakpoint
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_watchlist_item_id_watchlist_items_id_fk" FOREIGN KEY ("watchlist_item_id") REFERENCES "public"."watchlist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recap_searches" ADD CONSTRAINT "recap_searches_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_mutes" ADD CONSTRAINT "watchlist_mutes_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_candidates_item_entity" ON "match_candidates" USING btree ("watchlist_item_id","entity_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_list" ON "watchlist_items" USING btree ("watchlist_id");--> statement-breakpoint
CREATE INDEX "watchlist_items_entity" ON "watchlist_items" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_mutes_list_type" ON "watchlist_mutes" USING btree ("watchlist_id","event_type");