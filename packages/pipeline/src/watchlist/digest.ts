import { and, eq, isNotNull, isNull, subscribers, subscriptions, watchlists } from "@jw/db";
import { sendEmail, watchlistDigest } from "@jw/email";
import { weekLabel } from "@jw/radar";
import type { Job } from "../runner";
import { pacificDay } from "../schedule";
import { SEVERITY_LABELS } from "./events";
import { watchlistFeed } from "./feed";

const DAY = 86_400_000;

// Monday morning: each confirmed Watchlist user gets what was recorded on their customers since
// their last email. A quiet week is a two-line email.
export function watchlistDigestJob(): Job {
  return {
    name: "watchlist-digest",
    async run(ctx) {
      const site = ctx.email.config.siteUrl;
      const lists = await ctx.db
        .select({
          watchlistId: watchlists.id,
          lastSentAt: watchlists.lastSentAt,
          subscriberId: subscribers.id,
          email: subscribers.email,
          unsubscribeToken: subscribers.unsubscribeToken,
        })
        .from(watchlists)
        .innerJoin(subscribers, eq(watchlists.subscriberId, subscribers.id))
        .innerJoin(subscriptions, and(eq(subscriptions.subscriberId, subscribers.id), eq(subscriptions.tool, "watchlist")))
        .where(and(eq(subscriptions.active, true), isNotNull(subscribers.confirmedAt), isNull(subscribers.unsubscribedAt)));

      let sent = 0;
      let quiet = 0;
      let failed = 0;
      for (const l of lists) {
        // A retry the same week skips lists already sent.
        if (l.lastSentAt && ctx.now.getTime() - l.lastSentAt.getTime() < 6 * DAY) continue;
        const since = l.lastSentAt ?? new Date(ctx.now.getTime() - 7 * DAY);
        const feed = await watchlistFeed(ctx.db, l.watchlistId, since);
        if (feed.length === 0) continue;
        const customers = feed.map((c) => ({
          name: c.entity && !c.entity.watchOnly ? (c.entity.dba ?? c.entity.name) : c.name,
          events: c.events.map((e) => ({ severity: SEVERITY_LABELS[e.severity], date: e.date, note: e.note, sourceUrl: e.sourceUrl })),
        }));
        if (customers.every((c) => c.events.length === 0)) quiet++;
        const result = await sendEmail(ctx.email, {
          to: l.email,
          template: watchlistDigest({
            weekLabel: weekLabel(pacificDay(since), pacificDay(new Date(ctx.now.getTime() - DAY))),
            totalCustomers: feed.length,
            customers,
            needsReview: feed.filter((c) => c.matchStatus === "needs_review").length,
            dashboardUrl: `${site}/watchlist/list`,
            wantThisUrl: `${site}/watchlist/erp`,
          }),
          reason: "You got this because you set up a Customer Watchlist at joewaltman.com/watchlist.",
          subscriber: { id: l.subscriberId, unsubscribeToken: l.unsubscribeToken },
        });
        if (result.status === "sent" || result.status === "dryrun") {
          sent++;
          await ctx.db.update(watchlists).set({ lastSentAt: ctx.now }).where(eq(watchlists.id, l.watchlistId));
        } else failed++;
      }
      if (failed > 0 && sent === 0) throw new Error(`Watchlist digest: all ${failed} sends failed`);
      return { rowsIn: lists.length, rowsUpserted: sent, events: 0, meta: { sent, quiet, failed } };
    },
  };
}
