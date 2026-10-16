import { type Db, entities, entityEvents, entityIdentifiers } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { entityTypeFrom, entityTypeFromName, normalizeAddress, normalizeName, zip5 } from "./normalize";
import { addEvent, findCandidates, upsertEntity } from "./resolve";
import { nameSimilarity } from "./similarity";

describe("normalizeName", () => {
  it.each([
    ["The Pacific Coast Plumbing Co., Inc.", "PACIFIC COAST PLUMBING"],
    ["Pacific Coast Plumbing, LLC", "PACIFIC COAST PLUMBING"],
    ["PACIFIC COAST PLUMBING L.L.C.", "PACIFIC COAST PLUMBING"],
    ["Smith & Sons Corporation", "SMITH AND SONS"],
    ["Acme Dental, A Professional Corporation", "ACME DENTAL"],
    ["Encinitas Brewing Company LP", "ENCINITAS BREWING"],
    ["The Company", "COMPANY"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("normalizeAddress and zip5", () => {
  it("standardizes street words and units", () => {
    expect(normalizeAddress("123 North Coast Highway, Suite #4")).toBe("123 N COAST HWY STE STE 4");
    expect(normalizeAddress("55 Main Street")).toBe("55 MAIN ST");
  });
  it("pulls a five-digit ZIP", () => {
    expect(zip5("92024-1234")).toBe("92024");
    expect(zip5("CA 92101")).toBe("92101");
    expect(zip5("")).toBeNull();
  });
});

describe("entity types", () => {
  it.each([
    ["Sole Ownership", "sole_prop"],
    ["INDIVIDUAL", "sole_prop"],
    ["Limited Liability Company", "llc"],
    ["Limited Liability Partnership", "partnership"],
    ["Corporation", "corporation"],
    ["General Partnership", "partnership"],
    ["Non-Profit Corporation", "nonprofit"],
    ["Trust", "other"],
  ])("%s -> %s", (input, expected) => {
    expect(entityTypeFrom(input)).toBe(expected);
  });
  it("guesses from a name when the source does not say", () => {
    expect(entityTypeFromName("Blue Wave Surf LLC")).toBe("llc");
    expect(entityTypeFromName("Harbor Holdings, Inc.")).toBe("corporation");
    expect(entityTypeFromName("Taco Shop")).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("scores typos high and different businesses low", () => {
    expect(nameSimilarity("PACIFIC COAST PLUMBING", "PACIFIC COAST PLUMBING")).toBe(1);
    expect(nameSimilarity("PACIFIC COAST PLUMBING", "PACIFIC COST PLUMBING")).toBeGreaterThan(0.75);
    expect(nameSimilarity("PACIFIC COAST PLUMBING", "PACIFIC COAST PLUMBING AND HEATING")).toBeLessThan(0.9);
    expect(nameSimilarity("PACIFIC COAST PLUMBING", "HARBOR DENTAL")).toBeLessThan(0.5);
  });
});

describe("upsertEntity", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  const base = {
    source: "sd_biztax" as const,
    sourceId: "BT-1",
    name: "Pacific Coast Plumbing, Inc.",
    entityType: "corporation" as const,
    address1: "100 Main St",
    city: "San Diego",
    zip: "92101-0001",
    county: "San Diego",
    raw: { status: "Active" },
  };

  it("creates once and finds the same entity by identifier on re-run", async () => {
    const first = await upsertEntity(db, base);
    expect(first.matchedBy).toBe("new");
    const again = await upsertEntity(db, { ...base, raw: { status: "Inactive" } });
    expect(again).toEqual({ entityId: first.entityId, matchedBy: "identifier", previousRaw: { status: "Active" } });
    expect(await db.select().from(entities)).toHaveLength(1);
    const [ident] = await db.select().from(entityIdentifiers);
    expect(ident!.raw).toEqual({ status: "Inactive" });
  });

  it("merges a second source on exact normalized name plus ZIP, and fills blanks only", async () => {
    const a = await upsertEntity(db, { ...base, naics: null });
    const b = await upsertEntity(db, {
      source: "cslb",
      sourceId: "1000001",
      name: "PACIFIC COAST PLUMBING INC",
      zip: "92101",
      naics: "238220",
      address1: "999 Other St",
      raw: {},
    });
    expect(b.matchedBy).toBe("name_zip");
    expect(b.entityId).toBe(a.entityId);
    const [e] = await db.select().from(entities);
    expect(e!.naics).toBe("238220");
    expect(e!.address1).toBe("100 Main St");
    expect(await db.select().from(entityIdentifiers)).toHaveLength(2);
  });

  it("does not merge across ZIPs or on a fuzzy name", async () => {
    await upsertEntity(db, base);
    expect((await upsertEntity(db, { ...base, sourceId: "BT-2", zip: "92024" })).matchedBy).toBe("new");
    expect((await upsertEntity(db, { ...base, sourceId: "BT-3", name: "Pacific Cost Plumbing" })).matchedBy).toBe("new");
  });

  it("never stores a street address or phone for a sole proprietor", async () => {
    await upsertEntity(db, {
      ...base,
      sourceId: "BT-9",
      name: "Jane Doe Design",
      entityType: "sole_prop",
      address1: "12 Home Ln",
      phone: "619-555-0100",
    });
    const [e] = await db.select().from(entities);
    expect(e!.address1).toBeNull();
    expect(e!.phone).toBeNull();
    expect(e!.city).toBe("San Diego");
    expect(e!.zip).toBe("92101");
  });

  it("dedupes events by key", async () => {
    const { entityId } = await upsertEntity(db, base);
    const ev = {
      entityId,
      source: "sd_biztax" as const,
      eventType: "new_business",
      eventDate: "2026-10-15",
      severity: "info" as const,
      title: "New business tax certificate",
      dedupeKey: "sd_biztax:BT-1:new",
    };
    expect(await addEvent(db, ev)).toBe(true);
    expect(await addEvent(db, ev)).toBe(false);
    expect(await db.select().from(entityEvents)).toHaveLength(1);
  });

  it("offers fuzzy candidates with a confidence score", async () => {
    await upsertEntity(db, base);
    await upsertEntity(db, { ...base, sourceId: "BT-4", name: "Harbor Dental" });
    const c = await findCandidates(db, "Pacific Coast Plumbng", "San Diego");
    expect(c).toHaveLength(1);
    expect(c[0]!.name).toBe("Pacific Coast Plumbing, Inc.");
    expect(c[0]!.confidence).toBeGreaterThan(0.9);
    expect(c[0]!.confidence).toBeLessThan(1);
  });
});
