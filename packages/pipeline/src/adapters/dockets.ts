import { watchedDockets } from "@jw/content";
import { and, desc, eq, jobRuns } from "@jw/db";
import { docketUpdate, sendEmail } from "@jw/email";
import type { Job, JobContext } from "../runner";

// Federal dockets Joe follows (content/watched-dockets.json): read the newest entries daily through
// CourtListener and email him what is new. The first run only notes what is already there.
const ENTRIES_URL = "https://www.courtlistener.com/api/rest/v4/docket-entries/";

export interface DocketEntry {
  id: number;
  entryNumber: string;
  dateFiled: string;
  text: string;
}

// Docket entries as CourtListener returns them. Descriptions sit on the entry, or on its documents.
export function readEntries(body: unknown): DocketEntry[] {
  const results = (body as { results?: Array<Record<string, unknown>> }).results ?? [];
  return results.flatMap((r) => {
    const id = Number(r.id);
    if (!Number.isFinite(id)) return [];
    const docs = Array.isArray(r.recap_documents) ? (r.recap_documents as Array<Record<string, unknown>>) : [];
    const text = [r.description, ...docs.map((d) => d.description)].map((t) => String(t ?? "").replace(/\s+/g, " ").trim()).find((t) => t.length > 0) ?? "Filing (no description in the record)";
    return [{ id, entryNumber: r.entry_number === null || r.entry_number === undefined ? "" : String(r.entry_number), dateFiled: String(r.date_filed ?? "").slice(0, 10), text: text.slice(0, 600) }];
  });
}

async function latestEntries(ctx: JobContext, docketId: number, token: string, wait: (ms: number) => Promise<void>): Promise<DocketEntry[]> {
  const get = () =>
    ctx.fetch(`${ENTRIES_URL}?docket=${docketId}&order_by=-date_filed`, {
      headers: { Authorization: `Token ${token}`, "User-Agent": "joewaltman.com public-records pipeline (joe@joewaltman.com)" },
      signal: AbortSignal.timeout(60_000),
    });
  let res = await get();
  // Asked to slow down (the court search may have just used the minute's allowance): wait once.
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    await wait(Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000, 60_000));
    res = await get();
  }
  if (!res.ok) throw new Error(`CourtListener docket ${docketId} returned HTTP ${res.status}`);
  return readEntries(await res.json());
}

export function docketsJob(
  token: () => string | null = () => process.env.COURTLISTENER_API_TOKEN?.trim() || null,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Job {
  return {
    name: "dockets",
    async run(ctx) {
      const key = token();
      if (!key) throw new Error("COURTLISTENER_API_TOKEN is not set; CourtListener only serves docket entries to signed-in users");
      const [last] = await ctx.db
        .select({ meta: jobRuns.meta })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, "dockets"), eq(jobRuns.status, "success")))
        .orderBy(desc(jobRuns.startedAt), desc(jobRuns.finishedAt))
        .limit(1);
      const seen = (last?.meta?.seen as Record<string, number[]> | undefined) ?? {};
      const nextSeen: Record<string, number[]> = {};
      const latest: Record<string, DocketEntry[]> = {};
      let emailed = 0;
      for (const d of watchedDockets.dockets) {
        const entries = await latestEntries(ctx, d.id, key, wait);
        const before = seen[String(d.id)];
        const fresh = before ? entries.filter((e) => !before.includes(e.id)) : [];
        nextSeen[String(d.id)] = [...new Set([...entries.map((e) => e.id), ...(before ?? [])])].slice(0, 300);
        latest[String(d.id)] = entries.slice(0, 5);
        if (fresh.length === 0) continue;
        await sendEmail(ctx.email, {
          to: ctx.email.config.adminEmail,
          template: docketUpdate({
            caseName: d.name,
            court: d.court,
            docketUrl: d.url,
            why: d.why,
            entries: fresh.map((e) => ({ date: e.dateFiled, number: e.entryNumber, text: e.text })),
          }),
          reason: "You got this because joewaltman.com watches this court case for the Tariff Refund Tool.",
          bypassSuppression: true,
        });
        emailed += fresh.length;
        ctx.log(`dockets: ${fresh.length} new in ${d.name}`);
      }
      return { rowsIn: watchedDockets.dockets.length, rowsUpserted: emailed, events: 0, meta: { seen: nextSeen, latest, emailed } };
    },
  };
}
