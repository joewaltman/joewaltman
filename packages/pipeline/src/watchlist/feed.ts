import {
  type Db,
  type MatchStatus,
  type Severity,
  and,
  asc,
  desc,
  entityEvents,
  eq,
  gte,
  inArray,
  isNull,
  matchCandidates,
  watchlistItems,
  watchlistMutes,
} from "@jw/db";
import { type EntityCard, entityCards } from "./match";
import { WATCH_EVENTS, WATCH_EVENT_TYPES, watchNote } from "./events";

export interface FeedEvent {
  id: string;
  eventType: string;
  severity: Severity;
  // The date on the record, or the day it was recorded when the record has none.
  date: string;
  recordedAt: Date;
  note: string;
  sourceUrl: string | null;
  source: string;
}

export interface FeedCustomer {
  itemId: string;
  name: string;
  city: string | null;
  matchStatus: MatchStatus;
  entity: EntityCard | null;
  candidates: Array<EntityCard & { confidence: number }>;
  events: FeedEvent[];
}

const SEVERITY_ORDER: Record<Severity, number> = { serious: 0, watch: 1, info: 2 };

export async function mutedTypes(db: Db, watchlistId: string): Promise<Set<string>> {
  const rows = await db.select({ t: watchlistMutes.eventType }).from(watchlistMutes).where(eq(watchlistMutes.watchlistId, watchlistId));
  return new Set(rows.map((r) => r.t));
}

// Every customer on a list with the events recorded since a date, muted types left out.
export async function watchlistFeed(db: Db, watchlistId: string, since: Date): Promise<FeedCustomer[]> {
  const items = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.watchlistId, watchlistId), isNull(watchlistItems.removedAt)))
    .orderBy(asc(watchlistItems.rawName));
  if (items.length === 0) return [];
  const muted = await mutedTypes(db, watchlistId);
  const types = WATCH_EVENT_TYPES.filter((t) => !muted.has(t));
  const entityIds = [...new Set(items.map((i) => i.entityId).filter((id): id is string => id !== null))];
  const reviewIds = items.filter((i) => i.matchStatus === "needs_review").map((i) => i.id);
  const [events, candidates] = await Promise.all([
    entityIds.length > 0 && types.length > 0
      ? db
          .select()
          .from(entityEvents)
          .where(and(inArray(entityEvents.entityId, entityIds), inArray(entityEvents.eventType, types), gte(entityEvents.createdAt, since)))
          .orderBy(desc(entityEvents.createdAt))
      : Promise.resolve([]),
    reviewIds.length > 0
      ? db.select().from(matchCandidates).where(inArray(matchCandidates.watchlistItemId, reviewIds)).orderBy(desc(matchCandidates.confidence))
      : Promise.resolve([]),
  ]);
  const cards = await entityCards(db, [...new Set([...entityIds, ...candidates.map((c) => c.entityId)])]);

  return items.map((item) => ({
    itemId: item.id,
    name: item.rawName,
    city: item.city,
    matchStatus: item.matchStatus,
    entity: item.entityId ? cards.get(item.entityId) ?? null : null,
    candidates: candidates
      .filter((c) => c.watchlistItemId === item.id)
      .flatMap((c) => {
        const card = cards.get(c.entityId);
        return card ? [{ ...card, confidence: c.confidence }] : [];
      }),
    events: events
      .filter((e) => e.entityId === item.entityId)
      .map((e) => ({
        id: e.id,
        eventType: e.eventType,
        severity: e.severity,
        date: e.eventDate ?? e.createdAt.toISOString().slice(0, 10),
        recordedAt: e.createdAt,
        note: watchNote({ eventType: e.eventType, title: e.title, summary: e.summary, raw: e.raw }),
        sourceUrl: e.sourceUrl,
        source: WATCH_EVENTS[e.eventType]?.source ?? e.source,
      }))
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.date.localeCompare(a.date)),
  }));
}
