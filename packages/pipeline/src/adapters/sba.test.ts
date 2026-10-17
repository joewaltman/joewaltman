import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, entities, entityEvents, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { type JobContext, runJob } from "../runner";
import { SBA_DATASET_PAGE, amountBand, parseSba, sbaFiles, sbaJob } from "./sba";

const dir = path.join(import.meta.dirname, "../../fixtures/sba");
const page = readFileSync(path.join(dir, "dataset-page.html"), "utf8");
const file7a = readFileSync(path.join(dir, "FOIA_7a_FY2020_Present_asof_260630.csv"));
const file504 = readFileSync(path.join(dir, "FOIA_504_FY2010_Present_asof_260630.csv"));

describe("SBA files", () => {
  it("finds the current file for each program and its as-of date", () => {
    expect(sbaFiles(page).map((f) => [f.program, f.name, f.asOf])).toEqual([
      ["504", "FOIA_504_FY2010_Present_asof_260630.csv", "2026-06-30"],
      ["7a", "FOIA_7a_FY2020_Present_asof_260630.csv", "2026-06-30"],
    ]);
  });

  it("keeps San Diego business loans over $250,000 approved after the last file", () => {
    const loans = parseSba(file7a, "7a", "2026-05-31");
    // Under the minimum, cancelled, older, Orange County and individual borrowers are left out.
    expect(loans.map((l) => [l.borrower, l.amount, l.lender])).toEqual([
      ["PATENAUDE & FELIX A PROFESSIONAL CORPORATION", 5000000, "OceanFirst Bank, National Association"],
      ["The MW Group, LLC", 1538500, "Wells Fargo Bank National Association"],
      ["Recon RF, Inc.", 3650000, "Newtek Bank, National Association"],
    ]);
    expect(parseSba(file504, "504", "2026-05-31").map((l) => l.borrower)).toEqual(["Inno Tech Manufacturing Inc.", "Bonita Smiles Dentistry", "Tortilleria La Princesa"]);
    expect(JSON.stringify(loans)).not.toContain("REDACTED");
  });

  it("bands amounts", () => {
    expect(amountBand(300_000)).toBe("$250,000 to $500,000");
    expect(amountBand(1_538_500)).toBe("$1 million to $2 million");
    expect(amountBand(5_000_000)).toBe("$5 million or more");
  });
});

describe("sba job", () => {
  let db: Db;
  let urls: string[];
  const ctx = (now = "2026-10-20T12:40:00Z"): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date(now),
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async (url) => {
      const u = String(url);
      urls.push(u);
      if (u === SBA_DATASET_PAGE) return new Response(page);
      return new Response(u.includes("_7a_") ? file7a : file504);
    },
  });

  beforeEach(async () => {
    db = await createTestDb();
    urls = [];
  });

  it("only records the as-of date the first time", async () => {
    const out = await runJob(sbaJob(), ctx());
    expect(out.result?.meta).toMatchObject({ asOf: { "7a": "2026-06-30", "504": "2026-06-30" }, baseline: ["504", "7a"] });
    expect(urls).toEqual([SBA_DATASET_PAGE]);
  });

  it("records loans that are new since the last file, dated the day they appear", async () => {
    await db.insert(jobRuns).values({ job: "sba", status: "success", startedAt: new Date("2026-07-01T12:00:00Z"), meta: { asOf: { "7a": "2026-05-31", "504": "2026-05-31" } } });
    const out = await runJob(sbaJob(), ctx());
    expect(out.result).toMatchObject({ rowsIn: 6, events: 6 });
    const events = await db.select().from(entityEvents);
    expect(events.every((e) => e.eventType === "sba_loan" && e.eventDate === "2026-10-20")).toBe(true);
    expect(events.find((e) => e.title === "SBA 7(a) loan approved" && e.summary?.includes("Wells Fargo"))?.summary).toBe(
      "Approved 2026-06-01. $1 million to $2 million from Wells Fargo Bank National Association. A business two years old or less",
    );
    expect((await db.select().from(entities)).find((e) => e.canonicalName.startsWith("Recon"))).toMatchObject({ category: "manufacturing", zip: "92128", entityType: "corporation" });
    // The same files again: nothing new.
    const again = await runJob(sbaJob(), ctx("2026-10-21T12:40:00Z"));
    expect(again.result?.events).toBe(0);
  });
});
