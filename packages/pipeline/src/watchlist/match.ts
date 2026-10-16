import {
  type Db,
  type EntityType,
  type MatchStatus,
  and,
  entities,
  entityIdentifiers,
  eq,
  inArray,
  isNull,
  matchCandidates,
  or,
  sql,
  watchlistItems,
} from "@jw/db";
import { entityTypeFromName, normalizeName, titleCase } from "../normalize";
import { nameSimilarity } from "../similarity";

export const MAX_CUSTOMERS = 25;
// At or above this a match is taken without asking, unless a second look-alike is just as close.
export const AUTO_CONFIRM = 0.9;
const MIN_CANDIDATE = 0.75;

export interface CustomerInput {
  name: string;
  city?: string | null;
  state?: string | null;
}

export interface Candidate {
  entityId: string;
  confidence: number;
}

// Pasted text: one customer per line. A tab separates name, city and state (a spreadsheet paste);
// otherwise "Name, City, ST" when the line ends in a two-letter state, or just the name.
export function parseCustomerLines(text: string): CustomerInput[] {
  const out: CustomerInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes("\t")) {
      const [name = "", city = "", state = ""] = line.split("\t").map((p) => p.trim());
      if (name) out.push({ name, city: city || null, state: state.toUpperCase() || null });
      continue;
    }
    const m = line.match(/^(.+?),\s*([A-Za-z .'-]+),\s*([A-Za-z]{2})$/);
    if (m && !/^(INC|LLC|LTD|CO|CORP|LP)$/i.test(m[3]!)) out.push({ name: m[1]!.trim(), city: m[2]!.trim(), state: m[3]!.toUpperCase() });
    else out.push({ name: line });
  }
  return out;
}

// Rows from an uploaded CSV, already split into cells. Uses a header row when it names the
// columns, otherwise reads name, city, state in that order.
export function customersFromRows(rows: string[][]): CustomerInput[] {
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  // An exact header wins; otherwise a header containing the word (but "st" only exactly).
  const find = (...names: string[]) => {
    const exact = header.findIndex((h) => names.includes(h));
    return exact >= 0 ? exact : header.findIndex((h) => names.some((n) => n.length > 2 && h.includes(n)));
  };
  const nameCol = find("customer", "company", "business", "name", "account");
  const hasHeader = nameCol >= 0;
  const cols = hasHeader ? { name: nameCol, city: find("city"), state: find("state", "st") } : { name: 0, city: 1, state: 2 };
  return (hasHeader ? rows.slice(1) : rows)
    .map((r) => ({
      name: (r[cols.name] ?? "").trim(),
      city: cols.city >= 0 ? (r[cols.city] ?? "").trim() || null : null,
      state: cols.state >= 0 ? (r[cols.state] ?? "").trim().toUpperCase().slice(0, 2) || null : null,
    }))
    .filter((c) => c.name.length > 0);
}

// Look-alikes from the public records, best first. Names and trade names both count, and a
// matching city nudges the score up (a different city nudges it down).
export async function findMatches(db: Db, input: CustomerInput, limit = 5): Promise<Candidate[]> {
  const target = normalizeName(input.name);
  const first = target.split(" ")[0];
  if (!first) return [];
  const prefix = `${first}%`;
  const rows = await db
    .select({ id: entities.id, norm: entities.normalizedName, dba: entities.normalizedDba, city: entities.city })
    .from(entities)
    .where(
      and(
        or(sql`${entities.normalizedName} like ${prefix}`, sql`${entities.normalizedDba} like ${prefix}`),
        // Names other Watchlist users typed are not public records to match against.
        sql`exists (select 1 from ${entityIdentifiers} where ${entityIdentifiers.entityId} = ${entities.id} and ${entityIdentifiers.source} <> 'watchlist')`,
      ),
    )
    .limit(1000);
  const city = input.city?.trim().toUpperCase();
  return rows
    .map((r) => {
      let score = Math.max(nameSimilarity(target, r.norm), r.dba ? nameSimilarity(target, r.dba) : 0);
      if (city && r.city) score += r.city.toUpperCase() === city ? 0.05 : -0.05;
      return { entityId: r.id, confidence: Math.round(Math.min(1, score) * 1000) / 1000 };
    })
    .filter((c) => c.confidence >= MIN_CANDIDATE)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

// Registered entities (LLC, corporation, partnership) are the only names searched in court
// records, so a sole proprietor's personal filings never show up.
const REGISTERED: EntityType[] = ["llc", "corporation", "partnership", "nonprofit"];
export function isRegisteredName(name: string, entityType?: EntityType | null): boolean {
  if (entityType) return REGISTERED.includes(entityType);
  const guess = entityTypeFromName(name);
  return guess !== null && REGISTERED.includes(guess);
}

// An entity for a registered name that matched nothing public yet, shared by everyone watching it.
export async function watchOnlyEntity(db: Db, input: CustomerInput): Promise<string | null> {
  if (!isRegisteredName(input.name)) return null;
  const normalized = normalizeName(input.name);
  if (!normalized) return null;
  const sourceId = `${normalized}|${(input.state ?? "").toUpperCase()}`;
  const [found] = await db
    .select({ entityId: entityIdentifiers.entityId })
    .from(entityIdentifiers)
    .where(and(eq(entityIdentifiers.source, "watchlist"), eq(entityIdentifiers.sourceId, sourceId)))
    .limit(1);
  if (found) return found.entityId;
  const [e] = await db
    .insert(entities)
    .values({
      canonicalName: titleCase(input.name) ?? input.name,
      normalizedName: normalized,
      entityType: entityTypeFromName(input.name),
      city: input.city ? titleCase(input.city) : null,
      state: input.state?.toUpperCase() ?? null,
    })
    .returning({ id: entities.id });
  await db.insert(entityIdentifiers).values({ entityId: e!.id, source: "watchlist", sourceId, raw: {} });
  return e!.id;
}

export interface AddResult {
  added: number;
  skipped: Array<{ name: string; reason: "duplicate" | "limit" }>;
}

// Adds customers to a list, matching each against the public records as it goes.
export async function addCustomers(db: Db, watchlistId: string, inputs: CustomerInput[]): Promise<AddResult> {
  const existing = await db
    .select({ rawName: watchlistItems.rawName, city: watchlistItems.city })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.watchlistId, watchlistId), isNull(watchlistItems.removedAt)));
  const key = (name: string, city?: string | null) => `${normalizeName(name)}|${(city ?? "").trim().toUpperCase()}`;
  const seen = new Set(existing.map((e) => key(e.rawName, e.city)));
  let room = MAX_CUSTOMERS - existing.length;
  const result: AddResult = { added: 0, skipped: [] };
  for (const raw of inputs) {
    const input = { name: raw.name.trim().slice(0, 200), city: raw.city?.trim().slice(0, 100) || null, state: raw.state?.trim().slice(0, 2) || null };
    if (!normalizeName(input.name)) continue;
    if (seen.has(key(input.name, input.city))) {
      result.skipped.push({ name: input.name, reason: "duplicate" });
      continue;
    }
    if (room <= 0) {
      result.skipped.push({ name: input.name, reason: "limit" });
      continue;
    }
    seen.add(key(input.name, input.city));
    room--;
    const matches = await findMatches(db, input);
    const [best, second] = matches;
    let status: MatchStatus;
    let entityId: string | null = null;
    if (best && best.confidence >= AUTO_CONFIRM && !(second && second.confidence >= AUTO_CONFIRM)) {
      status = "confirmed";
      entityId = best.entityId;
    } else if (best) {
      status = "needs_review";
    } else {
      status = "name_only";
      entityId = await watchOnlyEntity(db, input);
    }
    const [item] = await db
      .insert(watchlistItems)
      .values({ watchlistId, rawName: input.name, city: input.city, state: input.state, entityId, matchStatus: status, confidence: best?.confidence ?? null })
      .returning({ id: watchlistItems.id });
    if (status === "needs_review") {
      await db.insert(matchCandidates).values(matches.map((m) => ({ watchlistItemId: item!.id, entityId: m.entityId, confidence: m.confidence })));
    }
    result.added++;
  }
  return result;
}

// The user's answer for a customer that needed review: one of the candidates, or none of them.
export async function resolveMatch(db: Db, watchlistId: string, itemId: string, entityId: string | null): Promise<boolean> {
  const [item] = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId), isNull(watchlistItems.removedAt)))
    .limit(1);
  if (!item) return false;
  if (entityId) {
    const [c] = await db
      .select({ confidence: matchCandidates.confidence })
      .from(matchCandidates)
      .where(and(eq(matchCandidates.watchlistItemId, itemId), eq(matchCandidates.entityId, entityId)))
      .limit(1);
    // Confirmed matches can be undone and re-picked, so the current entity is a valid answer too.
    if (!c && item.entityId !== entityId) return false;
    await db
      .update(watchlistItems)
      .set({ entityId, matchStatus: "confirmed", confidence: c?.confidence ?? item.confidence })
      .where(eq(watchlistItems.id, itemId));
    return true;
  }
  const watchOnly = await watchOnlyEntity(db, { name: item.rawName, city: item.city, state: item.state });
  await db.update(watchlistItems).set({ entityId: watchOnly, matchStatus: "name_only" }).where(eq(watchlistItems.id, itemId));
  return true;
}

// "Not this one": puts a confirmed customer back to review, keeping its look-alikes to pick from.
export async function reopenMatch(db: Db, watchlistId: string, itemId: string): Promise<void> {
  const [item] = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId)))
    .limit(1);
  if (!item) return;
  const matches = await findMatches(db, { name: item.rawName, city: item.city, state: item.state });
  const others = matches.filter((m) => m.entityId !== item.entityId);
  if (others.length > 0) {
    await db
      .insert(matchCandidates)
      .values(others.map((m) => ({ watchlistItemId: itemId, entityId: m.entityId, confidence: m.confidence })))
      .onConflictDoNothing();
  }
  if (others.length === 0) {
    const watchOnly = await watchOnlyEntity(db, { name: item.rawName, city: item.city, state: item.state });
    await db.update(watchlistItems).set({ entityId: watchOnly, matchStatus: "name_only" }).where(eq(watchlistItems.id, itemId));
    return;
  }
  await db.update(watchlistItems).set({ entityId: null, matchStatus: "needs_review" }).where(eq(watchlistItems.id, itemId));
}

export async function removeCustomer(db: Db, watchlistId: string, itemId: string): Promise<void> {
  await db
    .update(watchlistItems)
    .set({ removedAt: new Date() })
    .where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.watchlistId, watchlistId)));
}

const IDENTIFIER_LABELS: Record<string, string> = {
  sos: "Secretary of State entity",
  cslb: "CSLB license",
  abc: "ABC license",
  sd_biztax: "San Diego business tax account",
  dca: "DCA license",
  nppes: "NPI",
};

export interface EntityCard {
  id: string;
  name: string;
  dba: string | null;
  entityType: EntityType | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  identifiers: string[];
  watchOnly: boolean;
}

// What a person needs to tell look-alikes apart: address and the record numbers behind each one.
export async function entityCards(db: Db, ids: string[]): Promise<Map<string, EntityCard>> {
  const out = new Map<string, EntityCard>();
  if (ids.length === 0) return out;
  const [rows, idents] = await Promise.all([
    db.select().from(entities).where(inArray(entities.id, ids)),
    db
      .select({ entityId: entityIdentifiers.entityId, source: entityIdentifiers.source, sourceId: entityIdentifiers.sourceId })
      .from(entityIdentifiers)
      .where(inArray(entityIdentifiers.entityId, ids)),
  ]);
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.canonicalName,
      dba: r.dba,
      entityType: r.entityType,
      address: r.address1,
      city: r.city,
      zip: r.zip,
      identifiers: [],
      watchOnly: true,
    });
  }
  for (const i of idents) {
    const card = out.get(i.entityId);
    if (!card) continue;
    if (i.source === "watchlist") continue;
    card.watchOnly = false;
    const label = IDENTIFIER_LABELS[i.source];
    if (label) card.identifiers.push(`${label} ${i.sourceId}`);
  }
  return out;
}

