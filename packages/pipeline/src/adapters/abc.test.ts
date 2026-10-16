import { readFileSync } from "node:fs";
import { type Db, entities, entityEvents, eq } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import type { FetchedFile, JobContext } from "../runner";
import { abc, parseExport, parseReport } from "./abc";

const read = (name: string) => readFileSync(new URL(`../../fixtures/abc/${name}`, import.meta.url));
// The real export is a zip holding one CSV; the fixture is that CSV, zipped here.
const exportZip = zipSync({ "ABC-DailyDataExport.csv": new Uint8Array(read("export-sample.csv")) });
const files: FetchedFile[] = [
  { name: "DailyExport-CSV.zip", url: "x", body: exportZip },
  { name: "issued-0.html", url: "x", body: new Uint8Array(read("issued.html")) },
  { name: "applications-0.html", url: "x", body: new Uint8Array(read("applications.html")) },
  { name: "status-changes-0.html", url: "x", body: new Uint8Array(read("status-changes.html")) },
];

describe("parseExport", () => {
  const licenses = parseExport(exportZip);
  const byLicense = new Map(licenses.map((l) => [l.license, l]));

  it("keeps San Diego County licenses only, one record per license number", () => {
    expect(licenses).toHaveLength(12);
    expect(byLicense.has("683644")).toBe(true);
  });

  it("maps names, premises and license types, and drops mailing addresses", () => {
    const r = byLicense.get("683644")!.entity;
    expect(r).toMatchObject({ name: "Playa Bruja Corp.", dba: "Concrete Tacos", city: "San Diego", county: "San Diego" });
    expect(r.raw.license_type_description).toEqual(["On-Sale Beer & Wine - Eating Place"]);
    expect(JSON.stringify(r.raw)).not.toMatch(/Mail/i);
  });

  it("merges license types on one license", () => {
    const types = byLicense.get("593587")!.entity.raw.types as Array<{ code: string; status: string }>;
    expect(types.map((t) => `${t.code}:${t.status}`)).toEqual(["21:SUSPEN", "86:ACTIVE"]);
  });

  it("fails loudly when the format changes", () => {
    const bad = zipSync({ "x.csv": new TextEncoder().encode("a,b\n1,2\n") });
    expect(() => parseExport(bad)).toThrow(/format changed/);
  });
});

describe("parseReport", () => {
  it("reads issued licenses with action and escrow company", () => {
    const rows = parseReport("issued", read("issued.html").toString());
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({
      license: "680170",
      reportDate: "2026-10-14",
      typeCode: "41",
      status: "Active",
      action: "PER",
      escrow: "Pacific Homeland Escrow",
      dba: "THE ACE CRAB",
      owner: "TDSD2 LLC",
    });
  });

  it("reads status changes with from, to and transfer", () => {
    const rows = parseReport("status-changes", read("status-changes.html").toString());
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.license === "593587")).toMatchObject({ statusFrom: "ACTIVE", status: "SUSPEN", transfer: "21-357951" });
  });

  it("never keeps an individual licensee's name", () => {
    for (const name of ["issued.html", "applications.html", "status-changes.html"]) {
      const kind = name.replace(".html", "") as "issued" | "applications" | "status-changes";
      for (const r of parseReport(kind, read(name).toString())) expect(r.owner).not.toBe("REDACTED");
    }
  });

  it("returns nothing for a day with no report table", () => {
    expect(parseReport("issued", "<p id='rptdate'>Report Date: Saturday, October 10, 2026</p><p>There are no licenses</p>")).toEqual([]);
  });
});

describe("abc.upsert", () => {
  let db: Db;
  let ctx: JobContext;
  beforeEach(async () => {
    db = await createTestDb();
    ctx = { db, archive: memoryArchive(), email: undefined as never, now: new Date("2026-10-16T13:00:00Z"), fetch: async () => new Response(""), log: () => {} };
  });

  it("stores licenses, records dated events once, and skips unchanged licenses on re-run", async () => {
    const records = await abc.parse(files, ctx);
    const first = await abc.upsert(records, ctx);
    // 12 export licenses; 4 issued + 3 distinct applications + 8 status changes.
    expect(first).toEqual({ rowsUpserted: 12, events: 15 });
    const again = await abc.upsert(records, ctx);
    expect(again).toEqual({ rowsUpserted: 0, events: 0 });

    const suspended = await db.select().from(entityEvents).where(eq(entityEvents.eventType, "abc_status_change"));
    const susp = suspended.find((e) => e.title === "ABC license status ACTIVE to SUSPEN")!;
    expect(susp.severity).toBe("watch");
    expect(susp.sourceUrl).toContain("LICENSE=593587");

    // Licenses only in a report (not yet in the export) still get an entity.
    const names = (await db.select().from(entities)).map((e) => e.canonicalName);
    expect(names).toContain("Super Gp Foods & Associates");
  });
});
