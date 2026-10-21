import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, desc, entities, entityEvents, eq, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { type JobContext, runJob } from "../runner";
import { NPI_FILES_PAGE, isMaintenancePage, nppesJob, parseNpiData, weeklyFiles } from "./nppes";

const dir = path.join(import.meta.dirname, "../../fixtures/nppes");
const page = readFileSync(path.join(dir, "NPI_Files.html"), "utf8");
// The page CMS showed on October 21, 2026 while the whole download site was down.
const maintenance = readFileSync(path.join(dir, "NPI_Files_maintenance.html"), "utf8");
const zip = readFileSync(path.join(dir, "NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip"));
const csv = () => Object.entries(unzipSync(zip)).find(([n]) => n.startsWith("npidata") && !n.includes("fileheader"))![1];

describe("NPPES weekly files", () => {
  it("finds the weekly file on the downloads page", () => {
    expect(weeklyFiles(page)).toEqual([
      { name: "NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip", url: "https://download.cms.gov/nppes/NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip", end: "2026-10-11" },
    ]);
  });

  it("tells the maintenance notice apart from a changed page", () => {
    expect(isMaintenancePage(maintenance)).toBe(true);
    expect(isMaintenancePage(page)).toBe(false);
    expect(isMaintenancePage("<html><body>NPI Files</body></html>")).toBe(false);
  });

  it("keeps San Diego organizations and deactivations, never individual providers", () => {
    const rows = parseNpiData(csv());
    expect(rows.filter((r) => r.kind === "organization").map((r) => r.name)).toEqual([
      "ARIELLE MANGANIELLO PROFESSIONAL CLINICAL COUNSELOR PC",
      "AVIA DENTAL CARE",
      "SAN DIEGO COMMUNITY ACADEMY",
      "SAN DIEGO BONE AND FRACTURE SPECIALIST INC",
      "MAJESTY MANAGEMENT GROUP LLC",
      "SAN DIEGO CT SURGERY PC",
    ]);
    expect(rows.find((r) => r.kind === "deactivated")).toMatchObject({ npi: "1093693442", deactivated: "2026-10-05" });
    expect(JSON.stringify(rows)).not.toContain("REDACTED");
  });
});

describe("nppes job", () => {
  let db: Db;
  let urls: string[];
  const ctx = (listing = page, now = new Date("2026-10-12T12:40:00Z")): JobContext => ({
    db,
    archive: memoryArchive(),
    now,
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(String(url) === NPI_FILES_PAGE ? listing : zip);
    },
  });

  beforeEach(async () => {
    db = await createTestDb();
    urls = [];
  });

  it("records new practices in their categories, skips schools, and reads each week once", async () => {
    expect((await runJob(nppesJob(), ctx())).status).toBe("success");
    const rows = await db.select().from(entities);
    // The local education agency is left out.
    expect(rows.map((e) => [e.canonicalName, e.category]).sort()).toEqual([
      ["Arielle Manganiello Professional Clinical Counselor PC", "medical"],
      ["Avia Dental Care", "dental"],
      ["Majesty Management Group LLC", "medical"],
      ["San Diego Bone and Fracture Specialist INC", "medical"],
      ["San Diego Ct Surgery PC", "medical"],
    ]);
    const events = await db.select().from(entityEvents);
    // The 2021 practice is not new.
    expect(events.map((e) => [e.title, e.eventDate]).sort()).toEqual([
      ["New behavioral health practice registered (NPI)", "2026-10-05"],
      ["New dental clinic registered (NPI)", "2026-10-05"],
      ["New nursing or assisted living facility registered (NPI)", "2026-10-06"],
      ["New physician practice registered (NPI)", "2026-10-06"],
    ]);
    expect(events[0]!.sourceUrl).toMatch(/^https:\/\/npiregistry\.cms\.hhs\.gov\/provider-view\/\d{10}$/);

    urls = [];
    await runJob(nppesJob(), ctx());
    expect(urls).toEqual([NPI_FILES_PAGE]);
  });

  it("waits quietly while CMS has the download site down, then reads the missed week", async () => {
    const processed = ["NPPES_Data_Dissemination_092826_100426_Weekly_V2.zip"];
    await db.insert(jobRuns).values({ job: "nppes", status: "success", startedAt: new Date("2026-10-05T12:40:00Z"), meta: { processed } });

    const down = await runJob(nppesJob(), ctx(maintenance, new Date("2026-10-21T12:40:00Z")));
    expect(down.status).toBe("success");
    expect(urls).toEqual([NPI_FILES_PAGE]);
    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.status, "success")).orderBy(desc(jobRuns.startedAt)).limit(1);
    expect(run!.meta).toMatchObject({ processed, downSince: "2026-10-21" });

    // Back up: the week that came out during the outage is read, since earlier weeks are known.
    urls = [];
    expect((await runJob(nppesJob(), ctx(page, new Date("2026-10-23T12:40:00Z")))).status).toBe("success");
    expect(urls).toHaveLength(2);
    expect((await db.select().from(entities)).length).toBeGreaterThan(0);
  });

  it("fails once the site has been down for more than two weeks", async () => {
    await db.insert(jobRuns).values({ job: "nppes", status: "success", startedAt: new Date("2026-10-21T12:40:00Z"), meta: { processed: [], downSince: "2026-10-21" } });
    expect((await runJob(nppesJob(), ctx(maintenance, new Date("2026-11-04T12:40:00Z")))).status).toBe("success");
    const late = await runJob(nppesJob(), ctx(maintenance, new Date("2026-11-05T12:40:00Z")));
    expect(late.status).toBe("failed");
  });

  it("still fails right away when the page changes in some other way", async () => {
    expect((await runJob(nppesJob(), ctx("<html><body>NPI Files</body></html>"))).status).toBe("failed");
  });
});
