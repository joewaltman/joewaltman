import { readFileSync } from "node:fs";
import { type Db, entities, entityEvents } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import type { JobContext } from "../runner";
import { changesFor, cslb, looksComplete, parseCslb } from "./cslb";

const read = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/cslb/${name}`, import.meta.url)));
const sample = read("sample.csv");
const synthetic = read("synthetic-sole.csv");
const records = () => [...parseCslb(sample, 1), ...parseCslb(synthetic, 1)];

describe("parseCslb", () => {
  const byLicense = new Map(records().map((r) => [r.license, r]));

  it("keeps companies and sole owners with a separate trade name only", () => {
    expect(byLicense.size).toBe(17);
    expect(byLicense.has("9900001")).toBe(true);
    expect(byLicense.has("9900002")).toBe(false);
  });

  it("uses the legal name with the trade name as DBA", () => {
    const r = byLicense.get("1002727")!;
    expect(r.entity).toMatchObject({ name: "Protecta Roofing INC", dba: "Protect All Roofs", entityType: "corporation", naics: "23" });
    expect(r.entity.raw.classifications).toEqual(["B", "C39"]);
    expect(r.entity.raw.bond_cancelled).toBe("2026-11-07");
  });

  it("never keeps a sole owner's own name", () => {
    const r = byLicense.get("9900001")!;
    expect(r.entity.name).toBe("Example Tile Works");
    expect(JSON.stringify(r.entity)).not.toContain("JANE");
  });

  it("rejects a file with too few rows", () => {
    expect(() => parseCslb(sample)).toThrow(/looks incomplete/);
  });
});

describe("looksComplete", () => {
  it("wants a CRLF ending and enough lines", () => {
    expect(looksComplete(sample, 10)).toBe(true);
    expect(looksComplete(sample.slice(0, sample.length - 40), 10)).toBe(false);
    expect(looksComplete(sample, 100)).toBe(false);
  });
});

describe("changesFor", () => {
  const rec = records().find((r) => r.license === "1002594")!;

  it("reports a license as new only when it was issued recently", () => {
    expect(changesFor(rec, null, "2026-10-16")).toEqual([]);
    const fresh = records().find((r) => r.license === "1160327")!;
    expect(changesFor(fresh, null, "2026-10-16").map((c) => c.eventType)).toEqual(["cslb_new_license"]);
  });

  it("reports status, bond and workers' comp changes", () => {
    const before = { ...rec.entity.raw, primary_status: "CLEAR", bond_cancelled: null, workers_comp_type: "Exempt" };
    const changes = changesFor(rec, before, "2026-10-16");
    expect(changes.map((c) => [c.eventType, c.severity])).toEqual([
      ["cslb_status_change", "watch"],
      ["cslb_bond_cancellation", "watch"],
      ["cslb_workers_comp_change", "info"],
    ]);
    expect(changes[0]!.title).toBe("Contractor license status: CLEAR to Contr Bond Susp");
  });
});

describe("cslb.upsert", () => {
  let db: Db;
  const ctx = (day: string): JobContext => ({
    db,
    archive: memoryArchive(),
    email: undefined as never,
    now: new Date(`${day}T13:00:00Z`),
    fetch: async () => new Response(""),
    log: () => {},
  });
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("baselines quietly, then records changes and removals once", async () => {
    const day1 = await cslb.upsert(records(), ctx("2026-10-16"));
    // Only the two licenses issued in the last 45 days are news on the first run.
    expect(day1).toMatchObject({ rowsUpserted: 17, events: 2 });

    // Next day: one license goes back to CLEAR, one disappears from the file.
    const next = records()
      .filter((r) => r.license !== "1062670")
      .map((r) => (r.license === "1002594" ? { ...r, entity: { ...r.entity, raw: { ...r.entity.raw, primary_status: "CLEAR" } } } : r));
    const day2 = await cslb.upsert(next, ctx("2026-10-17"));
    expect(day2).toMatchObject({ rowsUpserted: 1, events: 2, meta: { removed: 1 } });
    const types = (await db.select().from(entityEvents)).map((e) => e.eventType).sort();
    expect(types).toEqual(["cslb_license_removed", "cslb_new_license", "cslb_new_license", "cslb_status_change"]);

    // The removal is not reported again the day after.
    const day3 = await cslb.upsert(next, ctx("2026-10-18"));
    expect(day3).toMatchObject({ rowsUpserted: 0, events: 0, meta: { removed: 0 } });
  });

  it("files contractors under construction and stores no street for sole owners", async () => {
    await cslb.upsert(records(), ctx("2026-10-16"));
    const rows = await db.select().from(entities);
    expect(rows.every((e) => e.category === "construction")).toBe(true);
    const solo = rows.find((e) => e.canonicalName === "Example Tile Works")!;
    expect(solo).toMatchObject({ address1: null, phone: null, city: "Encinitas", zipCluster: "north-county-coastal" });
  });
});
