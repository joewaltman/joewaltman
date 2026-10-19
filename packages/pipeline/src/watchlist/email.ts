import type { Db } from "@jw/db";
import { type Template, type WatchlistRow, watchlistDigest } from "@jw/email";
import { weekLabel } from "@jw/radar";
import { type FeedCustomer, watchlistFeed } from "./feed";

const DAY = 86_400_000;
const pacific = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);

const RANK = { serious: 0, watch: 1, info: 2 } as const;

// Table rows for the email: customers worst first, each customer's records worst first, and
// records of the same kind for one customer (nine federal lawsuits, say) folded into one row.
export function watchlistRows(feed: FeedCustomer[]): WatchlistRow[] {
  const blocks = feed
    .filter((c) => c.events.length > 0)
    .map((c) => {
      const customer = c.entity && !c.entity.watchOnly ? (c.entity.dba ?? c.entity.name) : c.name;
      const groups = new Map<string, typeof c.events>();
      for (const e of c.events) groups.set(`${e.eventType}|${e.headline}`, [...(groups.get(`${e.eventType}|${e.headline}`) ?? []), e]);
      const rows: WatchlistRow[] = [...groups.values()].map((evs) => {
        const sorted = [...evs].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.date.localeCompare(a.date));
        const top = sorted[0]!;
        const latest = [...evs].sort((a, b) => b.date.localeCompare(a.date))[0]!;
        return {
          customer,
          severity: top.severity,
          date: latest.date,
          headline: top.headline,
          detail: evs.length > 1 ? `${evs.length} records. The full list is on your Watchlist page.` : top.detail,
          sourceUrl: latest.sourceUrl,
          count: evs.length,
        };
      });
      rows.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.date.localeCompare(a.date));
      return { customer, worst: RANK[rows[0]!.severity], rows };
    });
  blocks.sort((a, b) => a.worst - b.worst || a.customer.localeCompare(b.customer));
  return blocks.flatMap((b) => b.rows);
}

// The weekly email for one list: events recorded since a date, through yesterday. Null for an empty list.
export async function watchlistEmail(db: Db, watchlistId: string, since: Date, now: Date, siteUrl: string): Promise<{ template: Template; quiet: boolean } | null> {
  const feed = await watchlistFeed(db, watchlistId, since);
  if (feed.length === 0) return null;
  const rows = watchlistRows(feed);
  return {
    quiet: rows.length === 0,
    template: watchlistDigest({
      weekLabel: weekLabel(pacific(since), pacific(new Date(now.getTime() - DAY))),
      totalCustomers: feed.length,
      rows,
      needsReview: feed.filter((c) => c.matchStatus === "needs_review").length,
      dashboardUrl: `${siteUrl}/watchlist/list`,
      wantThisUrl: `${siteUrl}/watchlist/erp`,
    }),
  };
}
