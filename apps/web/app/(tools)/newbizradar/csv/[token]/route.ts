import { and, eq, getDb, isNull, subscribers, subscriptions } from "@jw/db";
import { buildDigest, digestCsv, readCsvToken } from "@jw/radar";
import { sessionSecret } from "@/lib/server";

// The CSV linked from a subscriber's digest. The signed token names the subscriber and the week.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = readCsvToken(token.replace(/\.csv$/, ""), sessionSecret());
  if (!parsed) return new Response("This link is not valid.", { status: 404 });
  const [sub] = await getDb()
    .select({ preferences: subscriptions.preferences })
    .from(subscriptions)
    .innerJoin(subscribers, eq(subscriptions.subscriberId, subscribers.id))
    .where(and(eq(subscribers.id, parsed.subscriberId), eq(subscriptions.tool, "radar"), isNull(subscribers.unsubscribedAt)))
    .limit(1);
  if (!sub) return new Response("This link is not valid.", { status: 404 });
  const prefs = sub.preferences as { zipClusters?: string[]; categories?: string[] };
  const end = new Date(`${parsed.end}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const digest = await buildDigest(getDb(), {
    start: start.toISOString().slice(0, 10),
    end: parsed.end,
    clusters: prefs.zipClusters ?? [],
    categories: prefs.categories ?? [],
  });
  return new Response(digestCsv(digest), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="new-business-radar-${parsed.end}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
