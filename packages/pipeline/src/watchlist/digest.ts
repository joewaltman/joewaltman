import { and, eq, isNotNull, isNull, subscribers, subscriptions, watchlists } from "@jw/db";
import { sendEmail } from "@jw/email";
import type { Job } from "../runner";
import { watchlistEmail } from "./email";

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
        const email = await watchlistEmail(ctx.db, l.watchlistId, since, ctx.now, site);
        if (!email) continue;
        if (email.quiet) quiet++;
        const result = await sendEmail(ctx.email, {
          to: l.email,
          template: email.template,
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
