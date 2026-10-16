import { abcTypeName, isBarOrRestaurantType, taxonomy, zipClusters } from "@jw/content";
import {
  type Db,
  and,
  entities,
  entityEvents,
  entityIdentifiers,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from "@jw/db";

const ZONE = "America/Los_Angeles";
const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(d);

export interface Window {
  // Inclusive Pacific-time dates, YYYY-MM-DD.
  start: string;
  end: string;
}

// The seven days ending yesterday (Pacific). Sent on a Monday, that is the previous Monday to Sunday.
export function digestWindow(now: Date): Window {
  const end = new Date(`${day(now)}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const SOURCE_LABELS: Record<string, string> = {
  sd_biztax: "City of San Diego business tax",
  abc: "ABC liquor license",
  cslb: "CSLB contractor license",
  dca: "DCA professional license",
  nppes: "NPI registry",
  sba: "SBA loan",
};

const categoryLabels = new Map(taxonomy.categories.map((c) => [c.id, c.label]));
export const categoryLabel = (id: string | null) => (id ? categoryLabels.get(id) ?? null : null);
export const clusterLabel = (id: string) => zipClusters.clusters[id]?.label ?? id;

export interface BusinessRow {
  entityId: string;
  name: string;
  legalName: string | null;
  category: string | null;
  city: string | null;
  zip: string | null;
  cluster: string | null;
  sources: string[];
  firstSeen: string;
  website: string | null;
  note: string | null;
}

export interface EventRow {
  entityId: string;
  name: string;
  city: string | null;
  zip: string | null;
  cluster: string | null;
  date: string;
  title: string;
  details: string | null;
  sourceUrl: string | null;
}

export interface Digest extends Window {
  clusters: string[];
  categories: string[];
  newBusinesses: BusinessRow[];
  liquor: EventRow[];
  licenses: EventRow[];
}

export interface DigestOptions extends Window {
  clusters: string[];
  // Empty means every category.
  categories?: string[];
}

const LIQUOR_EVENTS = ["abc_application", "abc_issued", "abc_status_change"];

interface AbcRaw {
  typeCode?: string;
  status?: string;
  transfer?: string | null;
  escrow?: string | null;
}

// What a liquor license event means, in plain words, or null when it is not news to someone selling
// to a new bar or restaurant. The spec lists new applications, transfers and escrow; issued licenses
// are kept too. Other status changes (pending to active, a surrender or cancellation) are left out.
export function liquorAction(eventType: string, raw: AbcRaw): string | null {
  if (eventType === "abc_application") return "Applied for a liquor license";
  if (eventType === "abc_issued") return "Liquor license issued";
  if (eventType !== "abc_status_change") return null;
  // The seller's license is surrendered or cancelled; the buyer's goes pending, then active.
  if (raw.transfer) {
    return /^(SUREND|CANCEL)/i.test(raw.status ?? "") ? "Liquor license transferred to a new owner" : "Liquor license transferred from a previous owner";
  }
  if (raw.escrow) return "Liquor license sale in escrow";
  return null;
}

export async function buildDigest(db: Db, opts: DigestOptions): Promise<Digest> {
  const categories = opts.categories ?? [];
  const wants = (category: string) => categories.length === 0 || categories.includes(category);
  const empty: Digest = { ...opts, categories, newBusinesses: [], liquor: [], licenses: [] };
  if (opts.clusters.length === 0) return empty;

  const inWindow = and(gte(entityEvents.eventDate, opts.start), lte(entityEvents.eventDate, opts.end));
  const inClusters = inArray(entities.zipCluster, opts.clusters);
  const eventFields = {
    entityId: entities.id,
    canonicalName: entities.canonicalName,
    dba: entities.dba,
    category: entities.category,
    city: entities.city,
    zip: entities.zip,
    cluster: entities.zipCluster,
    website: entities.website,
    summary: entities.summary,
    eventDate: entityEvents.eventDate,
    eventType: entityEvents.eventType,
    title: entityEvents.title,
    details: entityEvents.summary,
    sourceUrl: entityEvents.sourceUrl,
    raw: entityEvents.raw,
  };

  // New businesses: one row per business, even when several sources or accounts report it.
  const businessEvents = await db
    .select(eventFields)
    .from(entityEvents)
    .innerJoin(entities, eq(entityEvents.entityId, entities.id))
    .where(
      and(
        eq(entityEvents.eventType, "new_business"),
        inWindow,
        inClusters,
        categories.length > 0 ? inArray(entities.category, categories) : undefined,
        // A certificate cancelled since it was issued is not a new business to call on.
        sql`coalesce(${entities.status}, '') <> 'Cancelled'`,
      ),
    );
  const byEntity = new Map<string, BusinessRow>();
  for (const e of businessEvents) {
    const prev = byEntity.get(e.entityId);
    if (prev && prev.firstSeen <= (e.eventDate ?? "")) continue;
    byEntity.set(e.entityId, {
      entityId: e.entityId,
      name: e.dba ?? e.canonicalName,
      legalName: e.dba ? e.canonicalName : null,
      category: e.category,
      city: e.city,
      zip: e.zip,
      cluster: e.cluster,
      sources: [],
      firstSeen: e.eventDate ?? opts.end,
      website: e.website,
      note: e.summary,
    });
  }
  if (byEntity.size > 0) {
    const idents = await db
      .select({ entityId: entityIdentifiers.entityId, source: entityIdentifiers.source })
      .from(entityIdentifiers)
      .where(inArray(entityIdentifiers.entityId, [...byEntity.keys()]));
    for (const i of idents) {
      const row = byEntity.get(i.entityId)!;
      const label = SOURCE_LABELS[i.source] ?? i.source;
      if (!row.sources.includes(label)) row.sources.push(label);
    }
  }

  const toEventRow = (e: (typeof businessEvents)[number]): EventRow => ({
    entityId: e.entityId,
    name: e.dba ?? e.canonicalName,
    city: e.city,
    zip: e.zip,
    cluster: e.cluster,
    date: e.eventDate ?? opts.end,
    title: e.title,
    details: e.details,
    sourceUrl: e.sourceUrl,
  });

  // Liquor license activity, for bars and restaurants only: one row per business, since a
  // restaurant often gets two or three licenses the same week.
  const liquorEvents = wants("restaurants-bars")
    ? await db
        .select(eventFields)
        .from(entityEvents)
        .innerJoin(entities, eq(entityEvents.entityId, entities.id))
        .where(and(inArray(entityEvents.eventType, LIQUOR_EVENTS), inWindow, inClusters))
    : [];
  const liquorByEntity = new Map<string, { row: EventRow; actions: Map<string, Set<string>>; escrow: Set<string> }>();
  for (const e of liquorEvents) {
    const raw = e.raw as AbcRaw;
    if (!isBarOrRestaurantType(String(raw.typeCode ?? ""))) continue;
    const action = liquorAction(e.eventType, raw);
    if (!action) continue;
    const entry = liquorByEntity.get(e.entityId) ?? { row: toEventRow(e), actions: new Map(), escrow: new Set() };
    const types = entry.actions.get(action) ?? new Set<string>();
    const type = abcTypeName(raw.typeCode);
    if (type) types.add(type);
    entry.actions.set(action, types);
    if (raw.escrow) entry.escrow.add(raw.escrow);
    if ((e.eventDate ?? "") > entry.row.date) entry.row.date = e.eventDate!;
    liquorByEntity.set(e.entityId, entry);
  }
  // "Liquor license issued (On-Sale General - Eating Place, Caterer's Permit)"
  const liquor = [...liquorByEntity.values()].map(({ row, actions, escrow }) => ({
    ...row,
    title: [...actions].map(([action, types]) => (types.size > 0 ? `${action} (${[...types].join(", ")})` : action)).join("; "),
    details: escrow.size > 0 ? `Escrow: ${[...escrow].join(", ")}` : null,
  }));

  // New contractor licenses.
  const licenses = wants("construction")
    ? (
        await db
          .select(eventFields)
          .from(entityEvents)
          .innerJoin(entities, eq(entityEvents.entityId, entities.id))
          .where(and(eq(entityEvents.eventType, "cslb_new_license"), inWindow, inClusters))
      ).map(toEventRow)
    : [];

  const byDateThenName = <T extends { name: string }>(date: (r: T) => string) => (a: T, b: T) =>
    date(b).localeCompare(date(a)) || a.name.localeCompare(b.name);
  return {
    ...empty,
    newBusinesses: [...byEntity.values()].sort(byDateThenName((r) => r.firstSeen)),
    liquor: liquor.sort(byDateThenName((r) => r.date)),
    licenses: licenses.sort(byDateThenName((r) => r.date)),
  };
}

export const digestSize = (d: Digest) => d.newBusinesses.length + d.liquor.length + d.licenses.length;

// What public pages may show: name, type and city only.
export interface PublicRow {
  name: string;
  type: string;
  city: string | null;
}

export function publicRows(d: Digest): { newBusinesses: PublicRow[]; liquor: PublicRow[]; licenses: PublicRow[] } {
  return {
    newBusinesses: d.newBusinesses.map((r) => ({ name: r.name, type: categoryLabel(r.category) ?? "Business", city: r.city })),
    liquor: d.liquor.map((r) => ({ name: r.name, type: r.title, city: r.city })),
    licenses: d.licenses.map((r) => ({ name: r.name, type: "New contractor license", city: r.city })),
  };
}

