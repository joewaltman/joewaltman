import { type Db, subscribers, subscriptions, watchlists } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { addEvent, upsertEntity } from "../resolve";
import type { JobContext } from "../runner";
import { watchlistDigestJob } from "./digest";
import { addCustomers } from "./match";

let db: Db;
let sent: OutgoingMessage[];
let ctx: JobContext;
const monday = new Date("2026-10-19T13:15:00Z");

async function list(email: string, confirmed = true) {
  const [s] = await db.insert(subscribers).values({ email, confirmedAt: confirmed ? monday : null }).returning();
  await db.insert(subscriptions).values({ subscriberId: s!.id, tool: "watchlist", active: confirmed });
  const [w] = await db.insert(watchlists).values({ subscriberId: s!.id }).returning();
  return w!.id;
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
});

describe("watchlist-digest job", () => {
  it("sends each list its new events with sources, a quiet note otherwise, and only once a week", async () => {
    const { entityId } = await upsertEntity(db, { source: "cslb", sourceId: "1000001", name: "Pacific Tile Works Inc", city: "Carlsbad", zip: "92008", raw: {} });
    await addEvent(db, {
      entityId,
      source: "cslb",
      eventType: "cslb_status_change",
      eventDate: "2026-10-15",
      severity: "watch",
      title: "Contractor license status: CLEAR to SUSPENDED",
      sourceUrl: "https://www.cslb.ca.gov/x",
      dedupeKey: "s1",
    });
    await addCustomers(db, await list("ar@example.com"), [{ name: "Pacific Tile Works", city: "Carlsbad" }, { name: "Harbor Supply LLC" }]);
    await addCustomers(db, await list("quiet@example.com"), [{ name: "Harbor Supply LLC" }]);
    await addCustomers(db, await list("pending@example.com", false), [{ name: "Pacific Tile Works" }]);

    const out = await watchlistDigestJob().run(ctx);
    expect(out.meta).toMatchObject({ sent: 2, quiet: 1, failed: 0 });
    const ar = sent.find((m) => m.to === "ar@example.com")!;
    expect(ar.subject).toBe("Customer Watchlist: new public records on 1 customer, October 12 to 18, 2026");
    expect(ar.text).toContain("Worth a look, 2026-10-15: Contractor license status changed from clear to suspended.");
    expect(ar.text).toContain("https://www.cslb.ca.gov/x");
    expect(ar.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.find((m) => m.to === "quiet@example.com")!.subject).toBe("Customer Watchlist: nothing new this week");
    expect(sent.some((m) => m.to === "pending@example.com")).toBe(false);

    const again = await watchlistDigestJob().run({ ...ctx, now: new Date(monday.getTime() + 30 * 60_000) });
    expect(again.meta).toMatchObject({ sent: 0 });
  });
});
