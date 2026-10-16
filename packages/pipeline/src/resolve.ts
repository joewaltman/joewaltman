import {
  type Db,
  type EntityType,
  type Severity,
  type Source,
  and,
  entities,
  entityEvents,
  entityIdentifiers,
  eq,
  or,
  sql,
} from "@jw/db";
import { categoryForNaics, clusterForZip, countyForZip } from "@jw/content";
import { normalizeName, zip5 } from "./normalize";
import { nameSimilarity } from "./similarity";

export interface EntityRecord {
  source: Source;
  sourceId: string;
  name: string;
  dba?: string | null;
  entityType?: EntityType | null;
  status?: string | null;
  formedAt?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  naics?: string | null;
  phone?: string | null;
  // The source record with any person-identifying fields already removed.
  raw: Record<string, unknown>;
}

export interface UpsertResult {
  entityId: string;
  matchedBy: "identifier" | "name_zip" | "new";
  // The raw record stored for this identifier before this run, for diffing. Null on first sight.
  previousRaw: Record<string, unknown> | null;
}

function cleanRecord(rec: EntityRecord) {
  const solo = rec.entityType === "sole_prop";
  const zip = zip5(rec.zip);
  const naics = rec.naics?.trim() || null;
  return {
    canonicalName: rec.name.trim(),
    normalizedName: normalizeName(rec.name),
    dba: rec.dba?.trim() || null,
    normalizedDba: rec.dba ? normalizeName(rec.dba) || null : null,
    entityType: rec.entityType ?? null,
    status: rec.status ?? null,
    formedAt: rec.formedAt ?? null,
    // Sole proprietors' business address is often a home, so it is never stored.
    address1: solo ? null : rec.address1?.trim() || null,
    address2: solo ? null : rec.address2?.trim() || null,
    city: rec.city?.trim() || null,
    state: rec.state?.trim() || "CA",
    zip,
    zipCluster: clusterForZip(zip),
    county: rec.county?.trim() || countyForZip(zip),
    naics,
    category: categoryForNaics(naics),
    phone: solo ? null : rec.phone?.trim() || null,
  };
}

// Finds the entity for a source record (exact identifier first, then exact name plus ZIP),
// or creates one, and stores the record against it. Fuzzy matches are never merged here;
// they are only offered as candidates for a person to confirm.
export async function upsertEntity(db: Db, rec: EntityRecord, now = new Date()): Promise<UpsertResult> {
  const clean = cleanRecord(rec);

  const [ident] = await db
    .select()
    .from(entityIdentifiers)
    .where(and(eq(entityIdentifiers.source, rec.source), eq(entityIdentifiers.sourceId, rec.sourceId)))
    .limit(1);

  if (ident) {
    await db
      .update(entityIdentifiers)
      .set({ raw: rec.raw, lastSeen: now })
      .where(eq(entityIdentifiers.id, ident.id));
    await fillBlanks(db, ident.entityId, clean, now);
    return { entityId: ident.entityId, matchedBy: "identifier", previousRaw: ident.raw };
  }

  let entityId: string | null = null;
  let matchedBy: UpsertResult["matchedBy"] = "new";
  if (clean.normalizedName && clean.zip) {
    const names = [clean.normalizedName, clean.normalizedDba].filter((n): n is string => Boolean(n));
    const matches = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.zip, clean.zip),
          or(...names.flatMap((n) => [eq(entities.normalizedName, n), eq(entities.normalizedDba, n)])),
        ),
      )
      .limit(2);
    // Two businesses with the same normalized name in one ZIP is ambiguous, so start a new entity.
    if (matches.length === 1) {
      entityId = matches[0]!.id;
      matchedBy = "name_zip";
      await fillBlanks(db, entityId, clean, now);
    }
  }

  if (!entityId) {
    const [created] = await db.insert(entities).values(clean).returning({ id: entities.id });
    entityId = created!.id;
  }

  await db
    .insert(entityIdentifiers)
    .values({ entityId, source: rec.source, sourceId: rec.sourceId, raw: rec.raw, firstSeen: now, lastSeen: now });
  return { entityId, matchedBy, previousRaw: null };
}

async function fillBlanks(db: Db, entityId: string, clean: ReturnType<typeof cleanRecord>, now: Date) {
  const set: Record<string, unknown> = { updatedAt: now };
  for (const key of ["dba", "normalizedDba", "entityType", "status", "formedAt", "city", "zip", "zipCluster", "county", "naics", "category"] as const) {
    if (clean[key] !== null) set[key] = sql`coalesce(${entities[key]}, ${clean[key]})`;
  }
  if (clean.entityType !== "sole_prop") {
    for (const key of ["address1", "address2", "phone"] as const) {
      if (clean[key] !== null) set[key] = sql`coalesce(${entities[key]}, ${clean[key]})`;
    }
  }
  await db.update(entities).set(set).where(eq(entities.id, entityId));
}

export interface NewEvent {
  entityId: string;
  source: Source;
  eventType: string;
  eventDate: string | null;
  severity: Severity;
  title: string;
  summary?: string | null;
  sourceUrl?: string | null;
  raw?: Record<string, unknown>;
  // Same key on a re-run means the same event, so re-runs never duplicate.
  dedupeKey: string;
}

export async function addEvent(db: Db, e: NewEvent): Promise<boolean> {
  const rows = await db
    .insert(entityEvents)
    .values({ ...e, summary: e.summary ?? null, sourceUrl: e.sourceUrl ?? null, raw: e.raw ?? {} })
    .onConflictDoNothing({ target: entityEvents.dedupeKey })
    .returning({ id: entityEvents.id });
  return rows.length > 0;
}

export interface Candidate {
  entityId: string;
  name: string;
  zip: string | null;
  city: string | null;
  confidence: number;
}

// Scored look-alikes in a county, for the Watchlist to show a person. Matches below 0.9 need confirming.
export async function findCandidates(
  db: Db,
  name: string,
  county: string | null,
  limit = 5,
): Promise<Candidate[]> {
  const target = normalizeName(name);
  const first = target.split(" ")[0];
  if (!first) return [];
  const rows = await db
    .select({ id: entities.id, name: entities.canonicalName, norm: entities.normalizedName, zip: entities.zip, city: entities.city })
    .from(entities)
    .where(
      and(
        county ? eq(entities.county, county) : sql`true`,
        sql`${entities.normalizedName} like ${`${first}%`}`,
      ),
    )
    .limit(500);
  return rows
    .map((r) => ({ entityId: r.id, name: r.name, zip: r.zip, city: r.city, confidence: nameSimilarity(target, r.norm) }))
    .filter((c) => c.confidence >= 0.75)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
