import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, entities, entityEvents, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { type JobContext, runJob } from "../runner";
import { dcaJob, fileUrl, folderUrl, looksLikePerson, parseBoxListing, parseDca, sanDiegoOnly, splitDba } from "./dca";

const dir = path.join(import.meta.dirname, "../../fixtures/dca");
const read = (name: string) => readFileSync(path.join(dir, name));
const text = (name: string) => read(name).toString("utf8");

describe("Box listing", () => {
  it("reads folders, files, sizes and versions from the shared folder page", () => {
    const root = parseBoxListing(text("box-root-page1.html"));
    expect(root.pageCount).toBe(2);
    expect(root.items.find((i) => i.name === "Pharmacy_7200")).toMatchObject({ type: "folder", id: 72555304900 });
    const auto = parseBoxListing(text("box-folder-automotive.html"));
    expect(auto.items.map((i) => i.name)).toEqual(["AutomotiveRepair_Data00.xls", "AutomotiveRepair_Counts.csv"]);
    expect(auto.items[0]).toMatchObject({ type: "file", id: 2500002902093 });
  });

  it("fails loudly when Box changes its page", () => {
    expect(() => parseBoxListing("<html></html>")).toThrow(/no folder listing/);
  });
});

describe("parseDca", () => {
  it("keeps San Diego County organizations of the listed types, with premises addresses", () => {
    const recs = parseDca(read("AutomotiveRepair_Data00.xls"), "AutomotiveRepair_1310");
    // The Los Angeles dealer and the individual technician are left out.
    expect(recs.map((r) => r.entity.name)).toEqual(["Safelite Auto Glass #5428", "Safelite Auto Glas #6064", "Infinite Motion INC"]);
    expect(recs[0]).toMatchObject({
      sourceId: "AutomotiveRepair_1310:Automotive Repair Dealer:314962",
      status: "Active",
      issued: "2026-01-02",
      entity: { address1: "5205 Avenida Encinas", city: "Carlsbad", zip: "92008", naics: "811111", county: "San Diego" },
    });
    expect(recs[2]!.entity.entityType).toBe("corporation");
    expect(JSON.stringify(recs)).not.toContain("REDACTED");
  });

  it("skips personal names and unlisted types, splits trade names, and drops non-premises addresses", () => {
    const recs = parseDca(read("BureauSecurityAndInvestigativeServices_Data00.xls"), "SecurityAndInvestigativeServices_0120");
    expect(recs.map((r) => [r.entity.name, r.entity.dba])).toEqual([
      ["Dempsey Alarms LLC", null],
      ["Cox Advanced Services California, LLC", "Cox Home Security"],
    ]);
  });

  it("tells personal names from business names", () => {
    expect(looksLikePerson("REDACTED PERSON")).toBe(true);
    expect(looksLikePerson("Wes Breedlove Investigations")).toBe(false);
    expect(looksLikePerson("Charles Auto Repair")).toBe(false);
    expect(looksLikePerson("Ngs, Llp")).toBe(false);
    expect(looksLikePerson("TWIN OAKS NAILS")).toBe(false);
    expect(looksLikePerson("JOHN Q PUBLIC")).toBe(true);
    expect(looksLikePerson("Sunrise Mobile Detailing")).toBe(false);
    expect(splitDba("ACME LLC DBA ACME LOCK")).toEqual({ name: "ACME LLC", dba: "ACME LOCK" });
  });

  it("archives only the header and San Diego rows", () => {
    const kept = new TextDecoder().decode(sanDiegoOnly(read("AutomotiveRepair_Data00.xls")));
    expect(kept.split("\n")).toHaveLength(5);
    expect(kept).not.toContain("Bellflower");
  });
});

describe("dca job", () => {
  let db: Db;
  let fetched: string[];
  let autoFile: string;
  let autoVersion: number;
  const autoListing = () =>
    text("box-folder-automotive.html").replace(/"contentUpdated": \d+/, `"contentUpdated": ${autoVersion}`);
  const ctx = (now: string): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date(now),
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async (url) => {
      const u = String(url);
      fetched.push(u);
      if (u === folderUrl(null)) return new Response(text("box-root-page1.html"));
      if (u === folderUrl(null, 2)) return new Response(text("box-root-page2.html"));
      if (u === folderUrl(72555975852)) return new Response(autoListing());
      if (u === fileUrl(2500002902093)) return new Response(autoFile);
      // Every other board's folder is empty in this test.
      return new Response('<script>Box.postStreamData = {"/app-api/enduserapp/shared-folder": {"pageCount": 1, "items": []}};</script>');
    },
  });

  beforeEach(async () => {
    db = await createTestDb();
    fetched = [];
    autoFile = text("AutomotiveRepair_Data00.xls");
    autoVersion = 1790882148;
  });

  it("records new licenses, then status changes and removals when the next month's file arrives", async () => {
    const first = await runJob(dcaJob(), ctx("2026-01-20T13:35:00Z"));
    expect(first.status).toBe("success");
    const news = await db.select().from(entityEvents);
    expect(news.map((e) => [e.eventType, e.eventDate, e.summary]).sort()).toEqual([
      ["new_business", "2026-01-20", "Issued 2026-01-02. Bureau of Automotive Repair, license 314962"],
      ["new_business", "2026-01-20", "Issued 2026-01-05. Bureau of Automotive Repair, license 314976"],
    ]);
    expect(await db.select().from(entities)).toHaveLength(3);
    const [run] = await db.select().from(jobRuns);
    expect((run!.meta as { versions: Record<string, number> }).versions["AutomotiveRepair_1310/AutomotiveRepair_Data00.xls"]).toBe(1790882148);

    // Same version on Box: nothing is downloaded again.
    fetched = [];
    await runJob(dcaJob(), ctx("2026-01-21T13:35:00Z"));
    expect(fetched).not.toContain(fileUrl(2500002902093));

    // A new month: one dealer goes delinquent and another drops out of the file.
    autoVersion += 86_400 * 30;
    autoFile = autoFile.replace(/(314962.*)\tActive/, "$1\tDelinquent").split("\n").filter((l) => !l.includes("314976")).join("\n");
    await runJob(dcaJob(), ctx("2026-02-20T13:35:00Z"));
    const later = (await db.select().from(entityEvents)).filter((e) => e.eventType !== "new_business");
    expect(later.map((e) => [e.eventType, e.severity, e.title]).sort()).toEqual([
      ["dca_license_removed", "watch", "Automotive Repair Dealer license no longer in the DCA file"],
      ["dca_status_change", "watch", "Automotive Repair Dealer license status: Active to Delinquent"],
    ]);
  });
});
