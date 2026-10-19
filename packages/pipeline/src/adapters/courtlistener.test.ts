import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, entityEvents, recapSearches, subscribers, watchlists } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import type { JobContext } from "../runner";
import { addCustomers } from "../watchlist/match";
import { type DocketResult, courtListenerJob, describeDocket, searchUrl } from "./courtlistener";

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../fixtures/courtlistener/search-rite-aid.json"), "utf8")) as { results: DocketResult[] };
const byNumber = (n: string) => fixture.results.find((r) => r.docketNumber === n)!;

describe("describeDocket", () => {
  it("calls a bankruptcy a filing only when the business is the debtor", () => {
    expect(describeDocket(byNumber("23-18993"), "Rite Aid Corporation")).toMatchObject({
      eventType: "bankruptcy_filing",
      severity: "serious",
      title: "Chapter 11 bankruptcy case filed",
      summary: "United States Bankruptcy Court, D. New Jersey, case 23-18993",
    });
    // A creditor listed in someone else's case is not filing for bankruptcy.
    expect(describeDocket(byNumber("23-18993"), "Armstrong Pharmaceuticals Inc")).toMatchObject({
      eventType: "bankruptcy_adversary",
      title: "Listed as a party in another company's bankruptcy case",
    });
  });

  it("tells defendants from plaintiffs", () => {
    expect(describeDocket(byNumber("2:26-cv-04436"), "Rite Aid Corp")).toMatchObject({ eventType: "federal_civil_case", role: "defendant", severity: "watch" });
    expect(describeDocket(byNumber("3:26-cv-00536"), "Rite Aid Corporation")).toMatchObject({ role: "plaintiff", severity: "info", title: "Filed a federal civil case" });
    expect(describeDocket(byNumber("23-01294"), "Rite Aid Corporation")).toMatchObject({ eventType: "bankruptcy_adversary", role: "plaintiff" });
  });

  it("ignores dockets where only a look-alike company is a party", () => {
    expect(describeDocket(byNumber("26-35080"), "Rite Aid Corporation")).toBeNull();
    expect(describeDocket(byNumber("25-01338"), "Rite Aid Corporation")).toBeNull();
  });

  it("searches the name without its suffix, from a date", () => {
    expect(searchUrl("Pacific Tile Works, Inc.", "2026-10-01")).toBe(
      "https://www.courtlistener.com/api/rest/v4/search/?type=d&q=party%3A%28%22Pacific+Tile+Works%22%29&filed_after=2026-10-01&order_by=dateFiled+desc",
    );
  });
});

describe("courtlistener job", () => {
  let db: Db;
  let urls: string[];
  let ctx: JobContext;

  beforeEach(async () => {
    db = await createTestDb();
    urls = [];
    ctx = {
      db,
      archive: memoryArchive(),
      now: new Date("2026-10-19T12:50:00Z"),
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(fixture), { headers: { "Content-Type": "application/json" } });
      },
      log: () => {},
      email: {} as JobContext["email"],
    };
    const [s] = await db.insert(subscribers).values({ email: "ar@example.com" }).returning();
    const [w] = await db.insert(watchlists).values({ subscriberId: s!.id }).returning();
    await addCustomers(db, w!.id, [{ name: "Rite Aid Corporation" }, { name: "Bob's Handyman Service" }]);
  });

  it("searches registered customers only, records matching dockets once, and remembers the search", async () => {
    const out = await courtListenerJob(() => "tok", 0).run(ctx);
    // The sole-proprietor-looking name is never searched.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("filed_after=2025-10-19");
    expect(out.meta).toMatchObject({ searched: 1, authenticated: true });
    const events = await db.select().from(entityEvents);
    expect(events.map((e) => e.eventType).sort()).toEqual(["bankruptcy_adversary", "bankruptcy_filing", "federal_civil_case", "federal_civil_case"]);
    expect(events.every((e) => e.sourceUrl?.startsWith("https://www.courtlistener.com/docket/"))).toBe(true);
    expect(JSON.stringify(events.map((e) => e.raw))).not.toContain("REDACTED");
    expect(await db.select().from(recapSearches)).toHaveLength(1);

    const again = await courtListenerJob(() => null, 0).run({ ...ctx, now: new Date("2026-10-20T12:50:00Z") });
    expect(again.events).toBe(0);
    // The second search starts two weeks before the first one ran.
    expect(urls[1]).toContain("filed_after=2026-10-05");
  });
});

describe("courtlistener rate limits", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    const [s] = await db.insert(subscribers).values({ email: "ar@example.com" }).returning();
    const [w] = await db.insert(watchlists).values({ subscriberId: s!.id }).returning();
    await addCustomers(db, w!.id, [{ name: "Rite Aid Corporation" }, { name: "Northstar Distributing LLC" }, { name: "Harbor Supply Inc" }]);
  });
  const ctxWith = (responses: number[]): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date("2026-10-19T12:50:00Z"),
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async () => {
      const status = responses.shift() ?? 200;
      return status === 429 ? new Response("slow down", { status: 429, headers: { "Retry-After": "5" } }) : new Response(JSON.stringify(fixture));
    },
  });

  it("waits once when asked to slow down, then carries on", async () => {
    const waits: number[] = [];
    const out = await courtListenerJob(() => null, 0, async (ms) => void waits.push(ms)).run(ctxWith([429, 200, 200, 200]));
    expect(waits).toEqual([5000]);
    expect(out.meta).toMatchObject({ searched: 3, due: 3, rateLimited: false, authenticated: false });
  });

  it("stops cleanly when still throttled, keeping what it found, and starts there next time", async () => {
    const out = await courtListenerJob(() => null, 0, async () => {}).run(ctxWith([200, 429, 429]));
    expect(out.meta).toMatchObject({ searched: 1, due: 3, rateLimited: true });
    expect(await db.select().from(recapSearches)).toHaveLength(1);
  });

  it("fails, with what to do, when every search is refused", async () => {
    await expect(courtListenerJob(() => null, 0, async () => {}).run(ctxWith([429, 429]))).rejects.toThrow(/A free key from courtlistener\.com/);
  });
});
