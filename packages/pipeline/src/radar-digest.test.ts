import { type Db, subscribers, subscriptions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "./archive";
import { radarDigestJob } from "./radar-digest";
import { addEvent, upsertEntity } from "./resolve";
import type { JobContext } from "./runner";

let db: Db;
let sent: OutgoingMessage[];
let ctx: JobContext;
// Monday October 19, 2026, 6:00am Pacific: the window is October 12 to 18.
const monday = new Date("2026-10-19T13:00:00Z");

async function subscriber(email: string, prefs: Record<string, unknown>, confirmed = true) {
  const [s] = await db.insert(subscribers).values({ email, confirmedAt: confirmed ? monday : null }).returning();
  await db.insert(subscriptions).values({ subscriberId: s!.id, tool: "radar", preferences: prefs, active: confirmed });
  return s!;
}

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  ctx = {
    db,
    archive: memoryArchive(),
    now: monday,
    fetch: async () => new Response(""),
    log: () => {},
    email: {
      db,
      transport: {
        async send(m) {
          sent.push(m);
          return { id: `x${sent.length}` };
        },
      },
      config: {
        mode: "live",
        adminEmail: "joewaltman@gmail.com",
        from: "Joe Waltman <joe@joewaltman.com>",
        replyTo: "joe@joewaltman.com",
        siteUrl: "https://joewaltman.com",
        postalAddress: "PO Box 1, Encinitas, CA 92024",
        resendApiKey: null,
        dryRunDir: "/tmp/unused",
      },
    },
  };
  const { entityId } = await upsertEntity(db, {
    source: "sd_biztax",
    sourceId: "1",
    name: "Leucadia Cafe LLC",
    dba: "Leucadia Cafe",
    city: "Encinitas",
    zip: "92024",
    naics: "722515",
    raw: {},
  });
  await addEvent(db, {
    entityId,
    source: "sd_biztax",
    eventType: "new_business",
    eventDate: "2026-10-14",
    severity: "info",
    title: "New City of San Diego business tax certificate",
    dedupeKey: "a",
  });
});

describe("radar-digest job", () => {
  it("sends each confirmed subscriber their areas, with list headers, a CSV link and a quiet note when empty", async () => {
    await subscriber("cpa@example.com", { zipClusters: ["north-county-coastal"], categories: [] });
    await subscriber("banker@example.com", { zipClusters: ["south-bay"], categories: [] });
    await subscriber("pending@example.com", { zipClusters: ["north-county-coastal"] }, false);

    const out = await radarDigestJob(() => "secret").run(ctx);
    expect(out.meta).toMatchObject({ sent: 2, quiet: 1, failed: 0, window: { start: "2026-10-12", end: "2026-10-18" } });
    const cpa = sent.find((m) => m.to === "cpa@example.com")!;
    expect(cpa.subject).toBe("New Business Radar: 1 new business in North County coastal, October 12 to 18, 2026");
    expect(cpa.text).toContain("NEW BUSINESSES\n- Leucadia Cafe (Restaurants, bars and food service), Encinitas 92024, Oct 14. Legal name: Leucadia Cafe LLC.");
    expect(cpa.html).toContain("#12b76a");
    expect(cpa.text).toContain("https://joewaltman.com/newbizradar/csv/");
    expect(cpa.text).toContain("Reply with a name you want more on.");
    expect(cpa.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(cpa.replyTo).toBe("joe@joewaltman.com");
    const banker = sent.find((m) => m.to === "banker@example.com")!;
    expect(banker.subject).toBe("New Business Radar: a quiet week in South Bay");
    expect(sent.some((m) => m.to === "pending@example.com")).toBe(false);
  });

  it("does not send twice in the same week", async () => {
    await subscriber("cpa@example.com", { zipClusters: ["north-county-coastal"] });
    await radarDigestJob(() => "secret").run(ctx);
    const again = await radarDigestJob(() => "secret").run({ ...ctx, now: new Date(monday.getTime() + 30 * 60_000) });
    expect(again.meta).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("refuses to run without a secret for the CSV links", async () => {
    await expect(radarDigestJob(() => null).run(ctx)).rejects.toThrow(/SESSION_SECRET/);
  });
});
