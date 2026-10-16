import { and, emailSends, eq, gt, inArray, isNotNull, isNull, subscribers, subscriptions } from "@jw/db";
import { radarDigest, sendEmail } from "@jw/email";
import { areasLabel, buildDigest, csvToken, digestEmailSections, digestSize, digestWindow, weekLabel } from "@jw/radar";
import type { Job } from "./runner";

export interface RadarPreferences {
  zipClusters?: string[];
  categories?: string[];
}

// Monday morning: one digest per confirmed Radar subscriber, filtered to their areas and categories.
export function radarDigestJob(secret: () => string | null = () => process.env.SESSION_SECRET?.trim() || null): Job {
  return {
    name: "radar-digest",
    async run(ctx) {
      const linkSecret = secret();
      if (!linkSecret) throw new Error("SESSION_SECRET is not set, so digest CSV links cannot be signed");
      const window = digestWindow(ctx.now);
      const site = ctx.email.config.siteUrl;

      const rows = await ctx.db
        .select({
          subscriberId: subscribers.id,
          email: subscribers.email,
          unsubscribeToken: subscribers.unsubscribeToken,
          preferences: subscriptions.preferences,
        })
        .from(subscriptions)
        .innerJoin(subscribers, eq(subscriptions.subscriberId, subscribers.id))
        .where(
          and(
            eq(subscriptions.tool, "radar"),
            eq(subscriptions.active, true),
            isNotNull(subscribers.confirmedAt),
            isNull(subscribers.unsubscribedAt),
          ),
        );

      // A re-run the same week (a retry after a failure) skips anyone already sent this week's digest.
      const alreadySent = new Set(
        rows.length === 0
          ? []
          : (
              await ctx.db
                .select({ subscriberId: emailSends.subscriberId })
                .from(emailSends)
                .where(
                  and(
                    eq(emailSends.template, "radar-digest"),
                    inArray(emailSends.status, ["sent", "dryrun"]),
                    gt(emailSends.createdAt, new Date(ctx.now.getTime() - 6 * 86_400_000)),
                  ),
                )
            ).map((r) => r.subscriberId),
      );

      let sent = 0;
      let quiet = 0;
      let failed = 0;
      for (const r of rows) {
        if (alreadySent.has(r.subscriberId)) continue;
        const prefs = r.preferences as RadarPreferences;
        const clusters = prefs.zipClusters ?? [];
        if (clusters.length === 0) continue;
        const digest = await buildDigest(ctx.db, { ...window, clusters, categories: prefs.categories ?? [] });
        if (digestSize(digest) === 0) quiet++;
        const areas = areasLabel(clusters);
        const result = await sendEmail(ctx.email, {
          to: r.email,
          template: radarDigest({
            areas,
            weekLabel: weekLabel(window.start, window.end),
            sections: digestEmailSections(digest),
            csvUrl: `${site}/newbizradar/csv/${csvToken(r.subscriberId, window.end, linkSecret)}`,
            wantThisUrl: `${site}/newbizradar/crm`,
          }),
          reason: `You got this because you subscribed to the New Business Radar for ${areas}.`,
          subscriber: { id: r.subscriberId, unsubscribeToken: r.unsubscribeToken },
          showForward: true,
        });
        if (result.status === "sent" || result.status === "dryrun") sent++;
        else failed++;
      }
      if (failed > 0 && sent === 0) throw new Error(`Radar digest: all ${failed} sends failed`);
      return { rowsIn: rows.length, rowsUpserted: sent, events: 0, meta: { window, sent, quiet, failed } };
    },
  };
}
