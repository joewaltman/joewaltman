import { type Db, entityIdentifiers, matchCandidates, subscribers, watchlistItems, watchlistMutes, watchlists } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { addEvent, upsertEntity } from "../resolve";
import { watchNote } from "./events";
import { watchlistFeed } from "./feed";
import { MAX_CUSTOMERS, addCustomers, customersFromRows, entityCards, isRegisteredName, parseCustomerLines, reopenMatch, resolveMatch } from "./match";

let db: Db;
let listId: string;

async function business(source: "cslb" | "abc" | "sd_biztax", id: string, name: string, city: string, zip: string, dba?: string) {
  const { entityId } = await upsertEntity(db, { source, sourceId: id, name, dba: dba ?? null, city, zip, raw: {} });
  return entityId;
}

beforeEach(async () => {
  db = await createTestDb();
  const [s] = await db.insert(subscribers).values({ email: "ar@example.com" }).returning();
  const [w] = await db.insert(watchlists).values({ subscriberId: s!.id }).returning();
  listId = w!.id;
});

describe("reading customer names", () => {
  it("takes one name per line, with city and state after commas or tabs", () => {
    expect(parseCustomerLines("Pacific Tile Works Inc, Carlsbad, CA\nAcme, Inc.\n\nHarbor Grill\tSan Diego\tca\n")).toEqual([
      { name: "Pacific Tile Works Inc", city: "Carlsbad", state: "CA" },
      { name: "Acme, Inc." },
      { name: "Harbor Grill", city: "San Diego", state: "CA" },
    ]);
  });

  it("does not mistake a trailing entity suffix for a state", () => {
    expect(parseCustomerLines("Smith Supply, Escondido, Co")).toEqual([{ name: "Smith Supply, Escondido, Co" }]);
  });

  it("reads CSV rows by header, or name, city, state without one", () => {
    expect(customersFromRows([["Customer Name", "City", "State"], ["Acme LLC", "Vista", "ca"], ["", "x", "y"]])).toEqual([
      { name: "Acme LLC", city: "Vista", state: "CA" },
    ]);
    expect(customersFromRows([["Acme LLC", "Vista"]])).toEqual([{ name: "Acme LLC", city: "Vista", state: null }]);
  });
});

describe("matching customers", () => {
  it("confirms a clear match, asks about close ones, and keeps unmatched names as name-only watches", async () => {
    const tile = await business("cslb", "1000001", "Pacific Tile Works Inc", "Carlsbad", "92008");
    await business("sd_biztax", "a1", "Harbor Grill LLC", "San Diego", "92101");
    await business("sd_biztax", "a2", "Harbor Grille Inc", "Oceanside", "92054");

    const r = await addCustomers(db, listId, [
      { name: "Pacific Tile Works", city: "Carlsbad" },
      { name: "Harbor Grill" },
      { name: "Northstar Distributing LLC" },
      { name: "Bob's Handyman Service" },
    ]);
    expect(r.added).toBe(4);
    const items = await db.select().from(watchlistItems);
    const by = (n: string) => items.find((i) => i.rawName === n)!;
    expect(by("Pacific Tile Works")).toMatchObject({ matchStatus: "confirmed", entityId: tile });
    expect(by("Harbor Grill")).toMatchObject({ matchStatus: "needs_review", entityId: null });
    expect(await db.select().from(matchCandidates)).toHaveLength(2);
    // A registered name with no public match gets a watch-only entity, so court searches can run.
    expect(by("Northstar Distributing LLC").matchStatus).toBe("name_only");
    expect(by("Northstar Distributing LLC").entityId).not.toBeNull();
    // A name that may be a sole proprietor gets no entity and no court searches.
    expect(by("Bob's Handyman Service")).toMatchObject({ matchStatus: "name_only", entityId: null });
  });

  it("never offers another user's typed name as a public-record match", async () => {
    await addCustomers(db, listId, [{ name: "Northstar Distributing LLC" }]);
    const [s] = await db.insert(subscribers).values({ email: "other@example.com" }).returning();
    const [w] = await db.insert(watchlists).values({ subscriberId: s!.id }).returning();
    await addCustomers(db, w!.id, [{ name: "Northstar Distributing LLC" }]);
    const items = await db.select().from(watchlistItems);
    expect(items.map((i) => i.matchStatus)).toEqual(["name_only", "name_only"]);
    // Both lists share the one watch-only entity.
    expect(new Set(items.map((i) => i.entityId)).size).toBe(1);
    expect(await db.select().from(entityIdentifiers)).toHaveLength(1);
  });

  it("stops at the list limit and skips duplicates", async () => {
    const names = Array.from({ length: MAX_CUSTOMERS + 2 }, (_, i) => ({ name: `Customer Number ${i} LLC` }));
    const r = await addCustomers(db, listId, [...names.slice(0, 2), { name: "customer number 0, llc" }, ...names.slice(2)]);
    expect(r.added).toBe(MAX_CUSTOMERS);
    expect(r.skipped.filter((s) => s.reason === "duplicate")).toHaveLength(1);
    expect(r.skipped.filter((s) => s.reason === "limit")).toHaveLength(2);
  });

  it("lets the user pick a candidate, pick none, or undo a match", async () => {
    const a = await business("sd_biztax", "a1", "Harbor Grill LLC", "San Diego", "92101");
    await business("sd_biztax", "a2", "Harbor Grille Inc", "Oceanside", "92054");
    await addCustomers(db, listId, [{ name: "Harbor Grill" }]);
    const [item] = await db.select().from(watchlistItems);
    expect(await resolveMatch(db, listId, item!.id, "00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(await resolveMatch(db, listId, item!.id, a)).toBe(true);
    expect((await db.select().from(watchlistItems))[0]).toMatchObject({ matchStatus: "confirmed", entityId: a });
    await reopenMatch(db, listId, item!.id);
    expect((await db.select().from(watchlistItems))[0]).toMatchObject({ matchStatus: "needs_review", entityId: null });
    await resolveMatch(db, listId, item!.id, null);
    expect((await db.select().from(watchlistItems))[0]).toMatchObject({ matchStatus: "name_only", entityId: null });
  });

  it("shows record numbers so look-alikes can be told apart", async () => {
    const id = await business("cslb", "1000001", "Pacific Tile Works Inc", "Carlsbad", "92008");
    const card = (await entityCards(db, [id])).get(id)!;
    expect(card.identifiers).toEqual(["CSLB license 1000001"]);
    expect(card.watchOnly).toBe(false);
  });

  it("only treats registered entity names as searchable in court records", () => {
    expect(isRegisteredName("Northstar Distributing LLC")).toBe(true);
    expect(isRegisteredName("Acme Corporation")).toBe(true);
    expect(isRegisteredName("Bob's Handyman Service")).toBe(false);
    expect(isRegisteredName("Anything", "sole_prop")).toBe(false);
  });
});

describe("the feed", () => {
  it("lists recent events per customer, worst first, and leaves out muted types and Radar-only events", async () => {
    const tile = await business("cslb", "1000001", "Pacific Tile Works Inc", "Carlsbad", "92008");
    await addCustomers(db, listId, [{ name: "Pacific Tile Works", city: "Carlsbad" }]);
    const ev = (eventType: string, severity: "info" | "watch" | "serious", title: string, key: string, raw = {}) =>
      addEvent(db, { entityId: tile, source: "cslb", eventType, eventDate: "2026-10-14", severity, title, dedupeKey: key, sourceUrl: "https://example.com/r", raw });
    await ev("cslb_status_change", "watch", "Contractor license status: CLEAR to SUSPENDED", "s");
    await ev("cslb_new_license", "info", "New contractor license", "n");
    await ev("cslb_bond_cancellation", "watch", "Contractor bond cancellation on file", "b");
    await ev("bankruptcy_filing", "serious", "Chapter 11 bankruptcy case filed", "k");
    await db.insert(watchlistMutes).values({ watchlistId: listId, eventType: "cslb_bond_cancellation" });

    const [c] = await watchlistFeed(db, listId, new Date(Date.now() - 86_400_000));
    expect(c!.events.map((e) => e.eventType)).toEqual(["bankruptcy_filing", "cslb_status_change"]);
    expect(c!.events[1]!.note).toBe("Contractor license status changed from clear to suspended.");
    expect(c!.events[1]!.sourceUrl).toBe("https://example.com/r");
    expect(await watchlistFeed(db, listId, new Date(Date.now() + 60_000))).toMatchObject([{ events: [] }]);
  });
});

describe("plain-English notes", () => {
  it("words DCA license changes plainly, with the license number", () => {
    expect(
      watchNote({ eventType: "dca_status_change", title: "Automotive Repair Dealer license status: Active to Delinquent", summary: "Bureau of Automotive Repair, license 314962", raw: {} }),
    ).toBe("State license (Automotive Repair Dealer) status changed from active to delinquent. Bureau of Automotive Repair, license 314962.");
  });

  it("spells out ABC codes it knows and shows the rest as ABC writes them", () => {
    expect(watchNote({ eventType: "abc_status_change", title: "", summary: null, raw: { statusFrom: "ACTIVE", status: "SUSPEN" } })).toBe(
      "Liquor license status changed from active to suspended.",
    );
    expect(watchNote({ eventType: "abc_status_change", title: "", summary: null, raw: { statusFrom: "REVPEN", status: "ACTIVE", transfer: "x" } })).toBe(
      "Liquor license status changed from REVPEN (ABC's code) to active. The record lists a license transfer.",
    );
  });
});
