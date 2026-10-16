import { type Severity, and, entities, eq, inArray, isNotNull, isNull, recapSearches, watchlistItems } from "@jw/db";
import { archiveKey } from "../archive";
import { normalizeName, titleCase } from "../normalize";
import { addEvent } from "../resolve";
import type { Job, JobContext } from "../runner";
import { pacificDay } from "../schedule";
import { isRegisteredName } from "../watchlist/match";

// Federal court dockets (PACER via CourtListener's RECAP archive) naming Watchlist customers.
// Docs: https://wiki.free.law/c/courtlistener/help/api/rest/v4/search
export const SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/";
const SITE = "https://www.courtlistener.com";
const DAY = 86_400_000;
// First search for a customer looks back a year; later ones overlap the last by two weeks,
// since dockets reach the archive days or weeks after filing.
const FIRST_LOOKBACK_DAYS = 365;
const OVERLAP_DAYS = 14;
const MAX_SEARCHES_PER_RUN = 500;
const PAUSE_MS = 1000;

export interface DocketResult {
  docket_id: number;
  court_id: string;
  court: string;
  caseName: string;
  dateFiled: string | null;
  docketNumber: string;
  chapter: string | number | null;
  suitNature: string | null;
  cause?: string | null;
  party: string[];
  docket_absolute_url: string;
}

export interface CourtEvent {
  eventType: "bankruptcy_filing" | "bankruptcy_adversary" | "federal_civil_case";
  severity: Severity;
  title: string;
  summary: string;
  role: "debtor" | "party" | "plaintiff" | "defendant";
}

const same = (a: string, b: string) => normalizeName(a) === normalizeName(b);

// What a docket means for the named business. Party lists can include people; only the business's
// own role and the court are kept, never the other names.
export function describeDocket(r: DocketResult, entityName: string): CourtEvent | null {
  if (!r.party.some((p) => same(p, entityName))) return null;
  const [left = "", right = ""] = r.caseName.split(/\s+v\.?\s+/i);
  const isMainCase = /bankruptcy/i.test(r.court) && r.chapter !== null && r.chapter !== "" && !right;
  // The first nature of suit without its code ("485 Telephone Consumer Protection Act" keeps the words).
  // A bankruptcy case lists every adversary category it may hear, so it gets none.
  const nature = isMainCase ? "" : (r.suitNature ?? "").split(";")[0]!.trim().replace(/^\d+\s+/, "");
  const where = `${r.court}, case ${r.docketNumber}${nature ? `, ${nature}` : ""}`;
  if (/bankruptcy/i.test(r.court)) {
    if (isMainCase && same(left.replace(/^in re:?\s*/i, ""), entityName)) {
      return { eventType: "bankruptcy_filing", severity: "serious", title: `Chapter ${r.chapter} bankruptcy case filed`, summary: where, role: "debtor" };
    }
    if (isMainCase) {
      return { eventType: "bankruptcy_adversary", severity: "watch", title: "Listed as a party in another company's bankruptcy case", summary: where, role: "party" };
    }
    const role = right && same(right, entityName) ? "defendant" : same(left, entityName) ? "plaintiff" : "party";
    const title = role === "defendant" ? "Named as a defendant in a bankruptcy court lawsuit" : role === "plaintiff" ? "Filed a lawsuit in bankruptcy court" : "Named as a party in a bankruptcy court lawsuit";
    return { eventType: "bankruptcy_adversary", severity: "watch", title, summary: where, role };
  }
  const role = right && same(right, entityName) ? "defendant" : same(left, entityName) ? "plaintiff" : "party";
  const title = role === "defendant" ? "Named as a defendant in a federal civil case" : role === "plaintiff" ? "Filed a federal civil case" : "Named as a party in a federal civil case";
  return { eventType: "federal_civil_case", severity: role === "plaintiff" ? "info" : "watch", title, summary: where, role };
}

// The search phrase: the name without its entity suffix, so "Acme Supply" finds "ACME SUPPLY, INC.".
export function searchUrl(entityName: string, filedAfter: string): string {
  const phrase = (titleCase(normalizeName(entityName)) ?? entityName).replace(/"/g, "");
  const params = new URLSearchParams({ type: "d", q: `party:("${phrase}")`, filed_after: filedAfter, order_by: "dateFiled desc" });
  return `${SEARCH_URL}?${params.toString()}`;
}

async function search(ctx: JobContext, url: string, token: string | null): Promise<DocketResult[]> {
  const res = await ctx.fetch(url, {
    headers: {
      "User-Agent": "joewaltman.com public-records pipeline (joe@joewaltman.com)",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 429) throw new Error("CourtListener rate limit reached (HTTP 429)");
  if (!res.ok) throw new Error(`CourtListener search returned HTTP ${res.status}`);
  const body = (await res.json()) as { results?: DocketResult[] };
  return body.results ?? [];
}

export function courtListenerJob(
  token: () => string | null = () => process.env.COURTLISTENER_API_TOKEN?.trim() || null,
  pauseMs = PAUSE_MS,
): Job {
  return {
    name: "courtlistener",
    async run(ctx) {
      const key = token();
      // Registered entities on any Watchlist, confirmed or watch-only, and when each was last searched.
      const watched = await ctx.db
        .selectDistinct({ id: entities.id, name: entities.canonicalName, entityType: entities.entityType, last: recapSearches.lastSearchedAt })
        .from(watchlistItems)
        .innerJoin(entities, eq(watchlistItems.entityId, entities.id))
        .leftJoin(recapSearches, eq(recapSearches.entityId, entities.id))
        .where(and(isNull(watchlistItems.removedAt), isNotNull(watchlistItems.entityId), inArray(watchlistItems.matchStatus, ["confirmed", "name_only"])));
      const due = watched
        .filter((w) => isRegisteredName(w.name, w.entityType))
        .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
        .slice(0, MAX_SEARCHES_PER_RUN);

      let events = 0;
      const kept: Array<Record<string, unknown>> = [];
      for (const [i, w] of due.entries()) {
        if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
        const from = w.last ? new Date(w.last.getTime() - OVERLAP_DAYS * DAY) : new Date(ctx.now.getTime() - FIRST_LOOKBACK_DAYS * DAY);
        const results = await search(ctx, searchUrl(w.name, pacificDay(from)), key);
        for (const r of results) {
          const d = describeDocket(r, w.name);
          if (!d) continue;
          const raw = { docketId: r.docket_id, courtId: r.court_id, court: r.court, dateFiled: r.dateFiled, docketNumber: r.docketNumber, chapter: r.chapter, suitNature: r.suitNature, role: d.role };
          kept.push({ entityId: w.id, ...raw });
          const added = await addEvent(ctx.db, {
            entityId: w.id,
            source: "recap",
            eventType: d.eventType,
            eventDate: r.dateFiled,
            severity: d.severity,
            title: d.title,
            summary: d.summary,
            sourceUrl: `${SITE}${r.docket_absolute_url}`,
            raw,
            dedupeKey: `recap:${r.docket_id}:${w.id}`,
          });
          if (added) events++;
        }
        await ctx.db
          .insert(recapSearches)
          .values({ entityId: w.id, lastSearchedAt: ctx.now })
          .onConflictDoUpdate({ target: recapSearches.entityId, set: { lastSearchedAt: ctx.now } });
      }
      // The archive keeps the matched dockets without party names, so no individual's name is stored.
      const archived = await ctx.archive.put(archiveKey("recap", pacificDay(ctx.now), "matches.json"), new TextEncoder().encode(JSON.stringify(kept)));
      return { rowsIn: due.length, rowsUpserted: kept.length, events, meta: { searched: due.length, watched: watched.length, authenticated: key !== null, archived } };
    },
  };
}
