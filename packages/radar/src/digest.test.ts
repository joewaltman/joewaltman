import { type Db, entities, entityEvents, entityIdentifiers } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { csvToken, digestCsv, readCsvToken } from "./csv";
import { buildDigest, digestSize, digestWindow, publicRows } from "./digest";

let db: Db;
let n = 0;

async function business(fields: Partial<typeof entities.$inferInsert> & { name: string }, sources: string[] = ["sd_biztax"]) {
  const [e] = await db
    .insert(entities)
    .values({
      canonicalName: fields.name,
      normalizedName: fields.name.toUpperCase(),
      city: "Encinitas",
      zip: "92024",
      zipCluster: "north-county-coastal",
      county: "San Diego",
      ...fields,
    })
    .returning();
  for (const source of sources) {
    await db.insert(entityIdentifiers).values({ entityId: e!.id, source: source as "abc", sourceId: `${source}-${++n}`, raw: {} });
  }
  return e!.id;
}

async function event(entityId: string, eventType: string, eventDate: string, raw: Record<string, unknown> = {}) {
  await db.insert(entityEvents).values({
    entityId,
    source: "sd_biztax",
    eventType,
    eventDate,
    severity: "info",
    title: eventType === "abc_application" ? "New ABC license application: On-Sale General - Eating Place" : "New",
    summary: eventType === "cslb_new_license" ? "Classifications: C10" : null,
    raw,
    dedupeKey: `k-${++n}`,
  });
}

const week = { start: "2026-10-12", end: "2026-10-18" };

beforeEach(async () => {
  db = await createTestDb();
});

describe("digestWindow", () => {
  it("covers the seven days ending yesterday, Pacific time", () => {
    // Monday October 19, 2026, 6:00am Pacific.
    expect(digestWindow(new Date("2026-10-19T13:00:00Z"))).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    // 11pm Sunday Pacific is still Sunday.
    expect(digestWindow(new Date("2026-10-19T06:00:00Z"))).toEqual({ start: "2026-10-11", end: "2026-10-17" });
  });
});

describe("buildDigest", () => {
  it("lists new businesses once, with all their sources, inside the window and area", async () => {
    const cafe = await business({ name: "Leucadia Cafe LLC", dba: "Leucadia Cafe", category: "restaurants-bars", summary: "Cafe in Encinitas." }, ["sd_biztax", "abc"]);
    await event(cafe, "new_business", "2026-10-14");
    await event(cafe, "new_business", "2026-10-15");
    const old = await business({ name: "Old Shop" });
    await event(old, "new_business", "2026-10-01");
    const away = await business({ name: "Chula Vista Shop", zip: "91910", zipCluster: "south-bay" });
    await event(away, "new_business", "2026-10-14");
    const gone = await business({ name: "Gone Inc", status: "Cancelled" });
    await event(gone, "new_business", "2026-10-14");

    const d = await buildDigest(db, { ...week, clusters: ["north-county-coastal"] });
    expect(d.newBusinesses).toHaveLength(1);
    expect(d.newBusinesses[0]).toMatchObject({
      name: "Leucadia Cafe",
      legalName: "Leucadia Cafe LLC",
      firstSeen: "2026-10-14",
      note: "Cafe in Encinitas.",
      sources: ["City of San Diego business tax", "ABC liquor license"],
    });
  });

  it("filters by category, and drops liquor and contractor sections that do not match", async () => {
    const roofer = await business({ name: "Coastal Roofing", category: "construction" });
    await event(roofer, "new_business", "2026-10-13");
    await event(roofer, "cslb_new_license", "2026-10-13");
    const bar = await business({ name: "Moonlight Bar", category: "restaurants-bars" });
    await event(bar, "abc_application", "2026-10-15", { typeCode: "48" });
    const store = await business({ name: "Corner Liquor", category: "retail" });
    await event(store, "abc_application", "2026-10-15", { typeCode: "21" });

    const all = await buildDigest(db, { ...week, clusters: ["north-county-coastal"] });
    expect(all.newBusinesses.map((r) => r.name)).toEqual(["Coastal Roofing"]);
    // Off-sale (type 21) is a store, not a bar or restaurant.
    expect(all.liquor.map((r) => r.name)).toEqual(["Moonlight Bar"]);
    expect(all.licenses.map((r) => r.name)).toEqual(["Coastal Roofing"]);
    expect(digestSize(all)).toBe(3);

    const food = await buildDigest(db, { ...week, clusters: ["north-county-coastal"], categories: ["restaurants-bars"] });
    expect(food.newBusinesses).toEqual([]);
    expect(food.liquor).toHaveLength(1);
    expect(food.licenses).toEqual([]);
  });

  it("lists each bar or restaurant once, in plain words, and leaves out closings and routine status changes", async () => {
    const brant = await business({ name: "The Brant Kitchen and Bar", category: "restaurants-bars" });
    await event(brant, "abc_issued", "2026-10-14", { typeCode: "47" });
    await event(brant, "abc_issued", "2026-10-14", { typeCode: "58" });
    await event(brant, "abc_status_change", "2026-10-15", { typeCode: "47", transfer: null, escrow: null });
    const closing = await business({ name: "Le Papagayo", category: "restaurants-bars" });
    await event(closing, "abc_status_change", "2026-10-15", { typeCode: "47", transfer: null, escrow: null });
    const sold = await business({ name: "Harbor Grill", category: "restaurants-bars" });
    await event(sold, "abc_status_change", "2026-10-16", { typeCode: "41", status: "PEND", transfer: "123456", escrow: "Pacific Escrow" });
    const seller = await business({ name: "Old Harbor Grill", category: "restaurants-bars" });
    await event(seller, "abc_status_change", "2026-10-16", { typeCode: "41", status: "SUREND", transfer: "654321", escrow: null });

    const d = await buildDigest(db, { ...week, clusters: ["north-county-coastal"] });
    expect(d.liquor.map((r) => [r.name, r.title, r.details])).toEqual([
      ["Harbor Grill", "Liquor license transferred from a previous owner (On-Sale Beer & Wine - Eating Place)", "Escrow: Pacific Escrow"],
      ["Old Harbor Grill", "Liquor license transferred to a new owner (On-Sale Beer & Wine - Eating Place)", null],
      ["The Brant Kitchen and Bar", "Liquor license issued (On-Sale General - Eating Place, Caterer's Permit)", null],
    ]);
  });

  it("returns nothing without an area", async () => {
    const id = await business({ name: "X" });
    await event(id, "new_business", "2026-10-14");
    expect(digestSize(await buildDigest(db, { ...week, clusters: [] }))).toBe(0);
  });

  it("shows only name, type and city on public pages, and full rows in the CSV", async () => {
    const id = await business({ name: "Leucadia Cafe", category: "restaurants-bars", website: "https://leucadiacafe.example" });
    await event(id, "new_business", "2026-10-14");
    const d = await buildDigest(db, { ...week, clusters: ["north-county-coastal"] });
    expect(publicRows(d).newBusinesses).toEqual([{ name: "Leucadia Cafe", type: "Restaurants, bars and food service", city: "Encinitas" }]);
    const csv = digestCsv(d);
    expect(csv.split("\r\n")[0]).toBe("section,date,name,legal_name,category,city,zip,area,sources,details,website,source_url");
    expect(csv).toContain("New business,2026-10-14,Leucadia Cafe,,\"Restaurants, bars and food service\",Encinitas,92024,North County coastal");
  });
});

describe("CSV links", () => {
  it("round-trips a signed token and rejects a tampered one", () => {
    const id = "6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f";
    const token = csvToken(id, "2026-10-18", "secret");
    expect(readCsvToken(token, "secret")).toEqual({ subscriberId: id, end: "2026-10-18" });
    expect(readCsvToken(token, "other")).toBeNull();
    expect(readCsvToken(token.replace("2026-10-18", "2026-10-11"), "secret")).toBeNull();
  });
});

describe("email formatting", () => {
  it("labels weeks and areas in plain English", async () => {
    const { areasLabel, weekLabel } = await import("./format");
    expect(weekLabel("2026-10-12", "2026-10-18")).toBe("October 12 to 18, 2026");
    expect(weekLabel("2026-09-28", "2026-10-04")).toBe("September 28 to October 4, 2026");
    expect(areasLabel(["north-county-coastal"])).toBe("North County coastal");
    expect(areasLabel(["north-county-coastal", "south-bay", "east-county"])).toBe("North County coastal, South Bay and East County");
  });

  it("writes one line per business with its note and sources", async () => {
    const { digestEmailSections } = await import("./format");
    const id = await business({ name: "Leucadia Cafe LLC", dba: "Leucadia Cafe", category: "restaurants-bars", summary: "Cafe in Encinitas." });
    await event(id, "new_business", "2026-10-14");
    const sections = digestEmailSections(await buildDigest(db, { ...week, clusters: ["north-county-coastal"] }));
    expect(sections[0]!.items).toEqual([
      "Leucadia Cafe (Leucadia Cafe LLC), restaurants, bars and food service, Encinitas 92024. First seen Oct 14. Cafe in Encinitas. Source: City of San Diego business tax.",
    ]);
    expect(sections[1]!.items).toEqual([]);
  });
});
