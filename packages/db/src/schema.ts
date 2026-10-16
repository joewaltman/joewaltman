import { randomBytes } from "node:crypto";
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const TOOLS = ["radar", "watchlist", "tariff", "aiwork"] as const;
export type Tool = (typeof TOOLS)[number];

export const ROLES = [
  "cpa",
  "banker",
  "insurance",
  "payroll",
  "cre",
  "attorney",
  "hr",
  "broker",
  "owner",
  "other",
] as const;
export type Role = (typeof ROLES)[number];

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  contactEmail: text("contact_email"),
  tool: text("tool").$type<Tool>(),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const subscribers = pgTable("subscribers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  company: text("company"),
  role: text("role").$type<Role>(),
  revenueBand: text("revenue_band"),
  headcountBand: text("headcount_band"),
  partnerId: uuid("partner_id").references(() => partners.id),
  // Stable token used in unsubscribe links and List-Unsubscribe headers.
  unsubscribeToken: text("unsubscribe_token")
    .notNull()
    .unique()
    .$defaultFn(() => randomBytes(24).toString("hex")),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    tool: text("tool").$type<Tool>().notNull(),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("subscriptions_subscriber_tool").on(t.subscriberId, t.tool)],
);

export const questionnaireResponses = pgTable("questionnaire_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tool: text("tool").$type<Tool>().notNull(),
  subscriberId: uuid("subscriber_id").references(() => subscribers.id),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  rulesVersion: text("rules_version").notNull(),
  createdAt: createdAt(),
});

export const handRaises = pgTable("hand_raises", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriberId: uuid("subscriber_id").references(() => subscribers.id),
  email: text("email"),
  tool: text("tool").$type<Tool>().notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const EMAIL_STATUSES = ["sent", "dryrun", "blocked", "suppressed", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const emailSends = pgTable(
  "email_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriberId: uuid("subscriber_id").references(() => subscribers.id),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    mode: text("mode").notNull(),
    status: text("status").$type<EmailStatus>().notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("email_sends_to_email").on(t.toEmail)],
);

export const suppressions = pgTable("suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    tool: text("tool").$type<Tool>(),
    subscriberId: uuid("subscriber_id").references(() => subscribers.id),
    path: text("path"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_type_created").on(t.type, t.createdAt)],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    status: text("status").$type<"running" | "success" | "failed">().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowsIn: integer("rows_in"),
    rowsUpserted: integer("rows_upserted"),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("job_runs_job_started").on(t.job, t.startedAt)],
);

export const authTokens = pgTable("auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").$type<"login" | "confirm">().notNull(),
  // For "confirm" tokens: which tool subscription the click activates.
  tool: text("tool").$type<Tool>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// Cached USITC lookups, so the calculator does not call the HTS service on every page view.
export const htsRates = pgTable("hts_rates", {
  htsNumber: text("hts_number").primaryKey(),
  description: text("description"),
  generalRateText: text("general_rate_text"),
  adValoremPct: doublePrecision("ad_valorem_pct"),
  sourceUrl: text("source_url").notNull(),
  raw: jsonb("raw").$type<unknown>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// Joe's notes from the admin pre-run helpers (an importer name, a careers page URL).
export const prerunNotes = pgTable(
  "prerun_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tool: text("tool").$type<Tool>().notNull(),
    subject: text("subject").notNull(),
    url: text("url"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("prerun_notes_tool_created").on(t.tool, t.createdAt)],
);

export const SOURCES = [
  "sos",
  "sd_biztax",
  "fbn",
  "abc",
  "cslb",
  "dca",
  "nppes",
  "sba",
  "ucc",
  "recap",
  "dlse",
  "recorder",
  "osha",
] as const;
export type Source = (typeof SOURCES)[number];

export const ENTITY_TYPES = ["corporation", "llc", "partnership", "sole_prop", "nonprofit", "government", "other"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// One business, merged across sources. Sole proprietors never get a street address or phone stored.
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    dba: text("dba"),
    normalizedDba: text("normalized_dba"),
    entityType: text("entity_type").$type<EntityType>(),
    status: text("status"),
    formedAt: date("formed_at"),
    address1: text("address1"),
    address2: text("address2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    zipCluster: text("zip_cluster"),
    county: text("county"),
    naics: text("naics"),
    category: text("category"),
    website: text("website"),
    phone: text("phone"),
    summary: text("summary"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("entities_name_zip").on(t.normalizedName, t.zip),
    index("entities_dba_zip").on(t.normalizedDba, t.zip),
    index("entities_county").on(t.county),
    index("entities_created").on(t.createdAt),
  ],
);

export const entityIdentifiers = pgTable(
  "entity_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    source: text("source").$type<Source>().notNull(),
    sourceId: text("source_id").notNull(),
    // The last record seen from the source, minus fields that identify a person. Monthly diffs compare against it.
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entity_identifiers_source_id").on(t.source, t.sourceId),
    index("entity_identifiers_entity").on(t.entityId),
  ],
);

export const SEVERITIES = ["info", "watch", "serious"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const entityEvents = pgTable(
  "entity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    source: text("source").$type<Source>().notNull(),
    eventType: text("event_type").notNull(),
    eventDate: date("event_date"),
    severity: text("severity").$type<Severity>().notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sourceUrl: text("source_url"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("entity_events_entity_date").on(t.entityId, t.eventDate),
    index("entity_events_type_created").on(t.eventType, t.createdAt),
  ],
);
