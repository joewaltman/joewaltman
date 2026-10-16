import type { Db } from "@jw/db";
import { type Template, watchlistDigest } from "@jw/email";
import { weekLabel } from "@jw/radar";
import { SEVERITY_LABELS } from "./events";
import { watchlistFeed } from "./feed";

const DAY = 86_400_000;
const pacific = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);

// The weekly email for one list: events recorded since a date, through yesterday. Null for an empty list.
export async function watchlistEmail(db: Db, watchlistId: string, since: Date, now: Date, siteUrl: string): Promise<{ template: Template; quiet: boolean } | null> {
  const feed = await watchlistFeed(db, watchlistId, since);
  if (feed.length === 0) return null;
  const customers = feed.map((c) => ({
    name: c.entity && !c.entity.watchOnly ? (c.entity.dba ?? c.entity.name) : c.name,
    events: c.events.map((e) => ({ severity: SEVERITY_LABELS[e.severity], date: e.date, note: e.note, sourceUrl: e.sourceUrl })),
  }));
  return {
    quiet: customers.every((c) => c.events.length === 0),
    template: watchlistDigest({
      weekLabel: weekLabel(pacific(since), pacific(new Date(now.getTime() - DAY))),
      totalCustomers: feed.length,
      customers,
      needsReview: feed.filter((c) => c.matchStatus === "needs_review").length,
      dashboardUrl: `${siteUrl}/watchlist/list`,
      wantThisUrl: `${siteUrl}/watchlist/erp`,
    }),
  };
}
