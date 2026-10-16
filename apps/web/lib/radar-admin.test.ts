import { type Db, entities, entityEvents, subscriptions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage, SendDeps } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { pickAreas, sendTestDigest } from "./radar-admin";
import { subscribe } from "./subscriptions";

let db: Db;
let sent: OutgoingMessage[];
let deps: SendDeps;
// Monday October 19, 2026, 6:00am Pacific: last week is October 12 to 18.
const monday = new Date("2026-10-19T13:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  deps = {
    db,
    transport: {
      async send(m) {
        sent.push(m);
        return { id: `fake-${sent.length}` };
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
  };
  const [e] = await db
    .insert(entities)
    .values({
      canonicalName: "Leucadia Cafe LLC",
      normalizedName: "leucadia cafe",
      dba: "Leucadia Cafe",
      city: "Encinitas",
      zip: "92024",
      zipCluster: "north-county-coastal",
      county: "San Diego",
      category: "restaurants-bars",
    })
    .returning();
  await db.insert(entityEvents).values({
    entityId: e!.id,
    source: "sd_biztax",
    eventType: "new_business",
    eventDate: "2026-10-14",
    severity: "info",
    title: "New City of San Diego business tax certificate",
    dedupeKey: "a",
  });
});

describe("pickAreas", () => {
  it("keeps known areas and falls back to North County coastal", () => {
    expect(pickAreas(["south-bay", "nowhere"])).toEqual(["south-bay"]);
    expect(pickAreas(["constructor"])).toEqual(["north-county-coastal"]);
    expect(pickAreas([])).toEqual(["north-county-coastal"]);
  });
});

describe("test digest", () => {
  it("goes to Joe only, with the admin CSV link and no list headers", async () => {
    const result = await sendTestDigest(deps, ["north-county-coastal"], monday);
    expect(result.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("joewaltman@gmail.com");
    expect(sent[0]!.subject).toBe("New Business Radar: 1 new business in North County coastal, October 12 to 18, 2026");
    expect(sent[0]!.text).toContain("https://joewaltman.com/admin/radar/csv?areas=north-county-coastal");
    expect(sent[0]!.headers["List-Unsubscribe"]).toBeUndefined();
  });

  it("sends the quiet-week version for an area with nothing new", async () => {
    await sendTestDigest(deps, ["south-bay"], monday);
    expect(sent[0]!.subject).toBe("New Business Radar: a quiet week in South Bay");
  });
});

describe("radar signup preferences", () => {
  it("stores the areas and replaces them when the same person signs up again", async () => {
    const input = { email: "cpa@example.com", tool: "radar" as const, name: null, company: null, role: null, partnerSlug: null };
    await subscribe(deps, { ...input, preferences: { zipClusters: ["south-bay"], categories: [] } });
    await subscribe(deps, { ...input, preferences: { zipClusters: ["north-county-coastal"], categories: ["construction"] } });
    const rows = await db.select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.preferences).toEqual({ zipClusters: ["north-county-coastal"], categories: ["construction"] });
  });
});
