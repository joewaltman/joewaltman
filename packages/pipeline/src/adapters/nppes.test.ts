import { readFileSync } from "node:fs";
import path from "node:path";
import { type Db, entities, entityEvents } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { type JobContext, runJob } from "../runner";
import { NPI_FILES_PAGE, nppesJob, parseNpiData, weeklyFiles } from "./nppes";

const dir = path.join(import.meta.dirname, "../../fixtures/nppes");
const page = readFileSync(path.join(dir, "NPI_Files.html"), "utf8");
const zip = readFileSync(path.join(dir, "NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip"));
const csv = () => Object.entries(unzipSync(zip)).find(([n]) => n.startsWith("npidata") && !n.includes("fileheader"))![1];

describe("NPPES weekly files", () => {
  it("finds the weekly file on the downloads page", () => {
    expect(weeklyFiles(page)).toEqual([
      { name: "NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip", url: "https://download.cms.gov/nppes/NPPES_Data_Dissemination_100526_101126_Weekly_V2.zip", end: "2026-10-11" },
    ]);
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
  const ctx = (): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date("2026-10-12T12:40:00Z"),
    log: () => {},
    email: {} as JobContext["email"],
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(String(url) === NPI_FILES_PAGE ? page : zip);
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
});
