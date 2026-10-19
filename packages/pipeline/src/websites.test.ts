import { type Db, entities } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "./archive";
import { addEvent, upsertEntity } from "./resolve";
import type { JobContext } from "./runner";
import { candidateDomains, pageMatches, websitesJob } from "./websites";

const cafe = { name: "Leucadia Cafe LLC", dba: null, city: "Encinitas", zip: "92024" };

describe("candidateDomains", () => {
  it("tries the joined and hyphenated .com names, from the trade name first", () => {
    expect(candidateDomains(["Harbor Example Cafe", "Example Hospitality LLC"])).toEqual([
      "harborexamplecafe.com",
      "harbor-example-cafe.com",
      "examplehospitality.com",
      "example-hospitality.com",
    ]);
  });

  it("skips personal names, very short names and names that will not make an address", () => {
    expect(candidateDomains(["JOHN Q PUBLIC"])).toEqual([]);
    expect(candidateDomains(["Fk"])).toEqual([]);
    expect(candidateDomains(["Spa"])).toEqual([]);
    expect(candidateDomains(["Café Ñandú"])).toEqual([]);
  });
});

describe("pageMatches", () => {
  it("accepts a page that names the business and where it is", () => {
    expect(pageMatches("<title>Leucadia Cafe</title><p>Breakfast and coffee. 123 Coast Hwy, Encinitas, CA 92024</p>", cafe)).toBe(true);
  });

  it("rejects parked domains, unrelated pages and same-named businesses elsewhere", () => {
    expect(pageMatches("<h1>leucadiacafe.com</h1><p>This domain is for sale! Leucadia Cafe Encinitas</p>", cafe)).toBe(false);
    expect(pageMatches("<p>Welcome to our blog about surfing in Encinitas.</p>", cafe)).toBe(false);
    expect(pageMatches("<p>Leucadia Cafe, 10 Main St, Portland, OR 97201</p>", cafe)).toBe(false);
  });
});

describe("websites job", () => {
  let db: Db;
  let asked: string[];
  beforeEach(async () => {
    db = await createTestDb();
    asked = [];
    for (const [id, name] of [["1", "Leucadia Cafe LLC"], ["2", "Pacific Example Tile Inc"]] as const) {
      const { entityId } = await upsertEntity(db, { source: "sd_biztax", sourceId: id, name, city: "Encinitas", zip: "92024", raw: {} });
      await addEvent(db, { entityId, source: "sd_biztax", eventType: "new_business", eventDate: "2026-10-14", severity: "info", title: "New", dedupeKey: `n${id}` });
    }
  });
  const ctx = (): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date("2026-10-19T12:47:00Z"),
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async (url) => {
      asked.push(String(url));
      if (String(url) === "https://leucadiacafe.com/") return new Response("<p>Leucadia Cafe, Encinitas CA</p>", { headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404 });
    },
  });

  it("saves a verified site, records that each business was tried, and does not try again", async () => {
    const out = await websitesJob().run(ctx());
    expect(out.meta).toMatchObject({ checked: 2, found: 1 });
    const rows = await db.select().from(entities);
    expect(rows.find((e) => e.canonicalName === "Leucadia Cafe LLC")!.website).toBe("https://leucadiacafe.com");
    expect(rows.every((e) => e.websiteCheckedAt !== null)).toBe(true);
    asked = [];
    await websitesJob().run(ctx());
    expect(asked).toEqual([]);
  });
});
