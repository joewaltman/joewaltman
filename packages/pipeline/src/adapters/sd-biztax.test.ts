import { readFileSync } from "node:fs";
import { type Db, entities, entityEvents, entityIdentifiers } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import type { FetchedFile, JobContext } from "../runner";
import { parseBizTax, sdBizTax } from "./sd-biztax";

const fixture = (name: string): FetchedFile => ({
  name,
  url: `file://${name}`,
  body: new Uint8Array(readFileSync(new URL(`../../fixtures/sd-biztax/${name}`, import.meta.url))),
});
const files = [fixture("sample.csv"), fixture("synthetic-sole.csv")];
const now = new Date("2026-10-16T18:00:00Z");

describe("parseBizTax", () => {
  const records = parseBizTax(files, now);
  const byKey = new Map(records.map((r) => [r.accountKey, r]));

  it("keeps accounts created in the last 10 days, from both files", () => {
    expect([...byKey.keys()].sort()).toEqual([
      "2026015289",
      "2026015320",
      "2026015455",
      "2026015467",
      "2026015499",
      "2026015807",
      "2026099901",
    ]);
    expect(byKey.get("2026015499")!.status).toBe("Cancelled");
  });

  it("maps a company row", () => {
    const r = byKey.get("2026015807")!;
    expect(r.createdOn).toBe("2026-10-15");
    expect(r.entity).toMatchObject({
      source: "sd_biztax",
      sourceId: "2026015807",
      dba: "The Cooking Penguin",
      entityType: "corporation",
      naics: "72232",
      city: "San Diego",
      zip: "92124-1196",
    });
  });

  it("uses only the trade name for a sole proprietor and drops personal columns", () => {
    const r = byKey.get("2026099901")!;
    expect(r.entity.name).toBe("Example Bakery");
    expect(r.entity.entityType).toBe("sole_prop");
    expect(r.entity.raw).not.toHaveProperty("business_owner_name");
    expect(r.entity.raw).not.toHaveProperty("address_road");
    expect(r.entity.raw).not.toHaveProperty("lat");
    expect(JSON.stringify(r.entity.raw)).not.toContain("JANE");
  });

  it("skips sole proprietors whose trade name is their own name, or who have none", () => {
    expect(byKey.has("2026099902")).toBe(false);
    expect(byKey.has("2026099903")).toBe(false);
  });

  it("fails loudly when the format changes", () => {
    const bad = { name: "x.csv", url: "x", body: new TextEncoder().encode('"id","name"\n"1","a"\n') };
    expect(() => parseBizTax([bad], now)).toThrow(/changed the file format/);
  });
});

describe("sdBizTax.upsert", () => {
  let db: Db;
  let ctx: JobContext;
  beforeEach(async () => {
    db = await createTestDb();
    ctx = {
      db,
      archive: memoryArchive(),
      email: undefined as never,
      now,
      fetch: async () => new Response(""),
      log: () => {},
    };
  });

  it("creates entities and events once, and re-runs add nothing", async () => {
    const records = parseBizTax(files, now);
    const first = await sdBizTax.upsert(records, ctx);
    expect(first).toEqual({ rowsUpserted: 7, events: 8 });
    const again = await sdBizTax.upsert(records, ctx);
    expect(again.events).toBe(0);
    expect(await db.select().from(entities)).toHaveLength(7);
    expect(await db.select().from(entityIdentifiers)).toHaveLength(7);
    expect(await db.select().from(entityEvents)).toHaveLength(8);
  });

  it("fills in cluster, county and category, and never stores a sole proprietor's street", async () => {
    await sdBizTax.upsert(parseBizTax(files, now), ctx);
    const rows = await db.select().from(entities);
    const penguin = rows.find((e) => e.dba === "The Cooking Penguin")!;
    expect(penguin).toMatchObject({
      zip: "92124",
      zipCluster: "central-san-diego",
      county: "San Diego",
      category: "restaurants-bars",
    });
    const bakery = rows.find((e) => e.canonicalName === "Example Bakery")!;
    expect(bakery).toMatchObject({ address1: null, city: "Encinitas", zipCluster: "north-county-coastal" });
  });
});
