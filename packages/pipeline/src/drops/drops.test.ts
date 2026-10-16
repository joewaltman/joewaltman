import { type Db, entities, entityEvents, manualDrops } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { upsertEntity } from "../resolve";
import { type JobContext, runJob } from "../runner";
import { manualDropsJob } from "./job";
import { processDrop } from "./process";
import { DropError, dropText, storeDrop } from "./store";
import { detectDelimiter, parseDate, splitLine } from "./table";

// These sources have no real sample file yet (see fixtures/manual/README.md). The rows below are
// synthetic, with made-up business names, shaped like the headers in content/manual-drops.json.
let db: Db;
const now = new Date("2026-10-19T13:00:00Z");
const csv = (...lines: string[]) => lines.join("\n");

beforeEach(async () => {
  db = await createTestDb();
});

describe("reading tables", () => {
  it("finds the delimiter, honors quotes and reads common date shapes", () => {
    expect(detectDelimiter("Entity Number\tEntity Name\tStatus")).toBe("\t");
    expect(detectDelimiter("a|b|c")).toBe("|");
    expect(splitLine('123,"Acme, Inc.",Active,"say ""hi"""', ",")).toEqual(["123", "Acme, Inc.", "Active", 'say "hi"']);
    expect(parseDate("10/4/2026")).toBe("2026-10-04");
    expect(parseDate("2026-10-04T00:00:00")).toBe("2026-10-04");
    expect(parseDate("20261004")).toBe("2026-10-04");
    expect(parseDate("soon")).toBeNull();
  });
});

describe("storing an upload", () => {
  it("keeps only San Diego County rows from a statewide file", async () => {
    const stored = await storeDrop(db, "sos", "sos.csv", [
      "Entity Number,Entity Name,Entity Type,Status,Registration Date,Principal City,Principal Zip",
      "B20260001,Example Supply LLC,Limited Liability Company,Active,10/01/2026,Vista,92083",
      "B20260002,Elsewhere Holdings LLC,Limited Liability Company,Active,10/01/2026,Fresno,93721",
    ]);
    expect(stored).toMatchObject({ rowsSeen: 2, rowsKept: 1, matched: { entityNumber: "Entity Number", zip: "Principal Zip" } });
    const [row] = await db.select().from(manualDrops);
    expect(dropText(row!.content)).not.toContain("Fresno");
    expect(row!.status).toBe("pending");
  });

  it("refuses a file without a required column and says what it found", async () => {
    await expect(storeDrop(db, "ucc", "x.csv", ["Debtor Name,City", "Example Supply LLC,Vista"])).rejects.toThrow(DropError);
    await expect(storeDrop(db, "ucc", "x.csv", ["Debtor Name,City", "Example Supply LLC,Vista"])).rejects.toThrow(/no column for filingNumber, filingDate\. Its columns are: Debtor Name, City/);
  });
});

describe("processing drops", () => {
  it("SOS: new entities, then status changes and statements of information on the next file", async () => {
    const header = "Entity Number\tEntity Name\tEntity Type\tStatus\tRegistration Date\tPrincipal Address\tPrincipal City\tPrincipal Zip\tLast SI File Date";
    const first = await processDrop(db, "sos", csv(header, "B20260001\tEXAMPLE SUPPLY LLC\tLimited Liability Company - CA\tActive\t10/01/2026\t100 Main St\tVista\t92083\t", "C1234567\tOLD EXAMPLE CORP\tStock Corporation - CA\tActive\t01/15/1998\t5 Elm St\tEscondido\t92025\t03/01/2026"), now);
    expect(first).toMatchObject({ rows: 2, upserted: 2, events: 1 });
    const [newOne] = await db.select().from(entityEvents);
    expect(newOne).toMatchObject({ eventType: "new_business", eventDate: "2026-10-01", title: "New California limited liability company - ca registered" });

    await processDrop(db, "sos", csv(header, "C1234567\tOLD EXAMPLE CORP\tStock Corporation - CA\tSuspended - FTB\t01/15/1998\t5 Elm St\tEscondido\t92025\t10/10/2026"), new Date("2026-11-19T13:00:00Z"));
    const later = (await db.select().from(entityEvents)).filter((e) => e.eventType !== "new_business");
    expect(later.map((e) => [e.eventType, e.severity, e.title]).sort()).toEqual([
      ["sos_statement_of_information", "info", "Statement of information filed"],
      ["sos_status_change", "serious", "Secretary of State status: Active to Suspended - FTB"],
    ]);
    const [corp] = (await db.select().from(entities)).filter((e) => e.canonicalName === "Old Example Corp");
    expect(corp).toMatchObject({ entityType: "corporation", address1: "5 Elm St", county: "San Diego" });
  });

  it("UCC: liens land on the existing business, people are skipped, secured parties shown only if businesses", async () => {
    const { entityId } = await upsertEntity(db, { source: "cslb", sourceId: "1000001", name: "Example Tile Works Inc", city: "Carlsbad", zip: "92008", raw: {} });
    const r = await processDrop(
      db,
      "ucc",
      csv(
        "File Number,Filing Type,File Date,Lapse Date,Debtor Name,Debtor City,Debtor Zip,Secured Party Name",
        "U26000001,State Tax Lien,10/12/2026,,EXAMPLE TILE WORKS INC,Carlsbad,92008,FRANCHISE TAX BOARD",
        "U26000002,UCC-1 Financing Statement,10/13/2026,10/13/2031,Example Tile Works Inc,Carlsbad,92008,REDACTED PERSON",
        "U26000003,Federal Tax Lien,10/13/2026,,REDACTED PERSON,Vista,92083,INTERNAL REVENUE SERVICE",
      ),
      now,
    );
    expect(r.skipped).toEqual({ "debtor not a business": 1 });
    const events = await db.select().from(entityEvents);
    expect(events.every((e) => e.entityId === entityId)).toBe(true);
    expect(events.map((e) => [e.eventType, e.severity, e.summary]).sort()).toEqual([
      ["tax_lien", "serious", "Filing U26000001"],
      ["ucc_filing", "watch", "Filing U26000002, lapses 2031-10-13"],
    ]);
  });

  it("Labor Commissioner: debarments follow the CSLB license number, judgments need a business name", async () => {
    const { entityId } = await upsertEntity(db, { source: "cslb", sourceId: "1000002", name: "Example Paving Inc", city: "Vista", zip: "92083", raw: {} });
    await processDrop(db, "dlse_debarment", csv("Contractor,CSLB License,Debarment Start,Debarment End", "Example Paving Inc,1000002,09/01/2026,08/31/2029"), now);
    const r = await processDrop(db, "dlse_judgments", csv("Case Number,Employer Name,Judgment Date,Judgment Amount", "WC-1001,Example Staffing LLC,10/02/2026,$12500.00", "WC-1002,REDACTED PERSON,10/02/2026,$900.00"), now);
    expect(r.skipped).toEqual({ "employer not a business": 1 });
    const events = await db.select().from(entityEvents);
    expect(events.find((e) => e.eventType === "dlse_debarment")).toMatchObject({ entityId, summary: "2026-09-01 to 2029-08-31, CSLB license 1000002" });
    expect(events.find((e) => e.eventType === "dlse_judgment")).toMatchObject({ severity: "serious", summary: "Case WC-1001, amount $12500.00" });
  });

  it("Recorder: picks the party each document type is about, and only businesses", async () => {
    const { entityId } = await upsertEntity(db, { source: "sd_biztax", sourceId: "a1", name: "Example Grill LLC", city: "San Diego", zip: "92101", raw: {} });
    const r = await processDrop(
      db,
      "recorder",
      csv(
        "Document Number,Document Type,Recording Date,Grantor,Grantee",
        "2026-0300001,NOTICE OF STATE TAX LIEN,10/14/2026,STATE OF CALIFORNIA EDD,EXAMPLE GRILL LLC",
        "2026-0300002,GRANT DEED,10/14/2026,EXAMPLE GRILL LLC,REDACTED PERSON",
        "2026-0300003,ABSTRACT OF JUDGMENT,10/14/2026,EXAMPLE SUPPLY LLC,REDACTED PERSON",
      ),
      now,
    );
    expect(r.skipped).toEqual({ "unlisted document type": 1, "party not a business": 1 });
    const [lien] = await db.select().from(entityEvents);
    expect(lien).toMatchObject({ entityId, eventType: "tax_lien", title: "State tax lien recorded", eventDate: "2026-10-14" });
  });

  it("FBN: a person registrant makes a sole proprietorship with no address; a company registrant is the legal name", async () => {
    await processDrop(
      db,
      "fbn",
      csv("File Number,Business Name,Filing Date,Business Address,Business City,Business Zip,Registrant", "2026-9000001,Sunrise Mobile Detailing,10/05/2026,1 Home Ct,Oceanside,92056,REDACTED PERSON", "2026-9000002,Harbor Example Cafe,10/06/2026,200 Harbor Dr,San Diego,92101,EXAMPLE HOSPITALITY LLC"),
      now,
    );
    const rows = await db.select().from(entities);
    expect(rows.find((e) => e.canonicalName === "Sunrise Mobile Detailing")).toMatchObject({ entityType: "sole_prop", address1: null, zip: "92056" });
    expect(rows.find((e) => e.dba === "Harbor Example Cafe")).toMatchObject({ canonicalName: "Example Hospitality LLC", entityType: "llc", address1: "200 Harbor Dr" });
    expect(JSON.stringify(rows)).not.toContain("REDACTED");
    expect((await db.select().from(entityEvents)).map((e) => e.eventType)).toEqual(["new_business", "new_business"]);
  });
});

describe("manual-drops job", () => {
  it("processes waiting files, records the result, and fails loudly on a bad one", async () => {
    await storeDrop(db, "fbn", "good.csv", ["File Number,Business Name,Filing Date", "2026-9000003,Example Bakery,10/07/2026"]);
    await db.insert(manualDrops).values({ source: "ucc", fileName: "bad.csv", rowsSeen: 1, rowsKept: 1, content: Buffer.from("not gzip") });
    const ctx = { db, archive: memoryArchive(), now, log: () => {}, fetch: async () => new Response(""), email: { db, config: { mode: "dryrun", adminEmail: "joewaltman@gmail.com", from: "x <x@x.com>", replyTo: "x@x.com", siteUrl: "https://joewaltman.com", postalAddress: null, resendApiKey: null, dryRunDir: "/tmp/jw-test-dryrun" } } } as unknown as JobContext;
    const outcome = await runJob(manualDropsJob(), ctx);
    expect(outcome.status).toBe("failed");
    const drops = await db.select().from(manualDrops);
    expect(drops.find((d) => d.fileName === "good.csv")).toMatchObject({ status: "processed", result: { rows: 1, events: 1 } });
    expect(drops.find((d) => d.fileName === "bad.csv")!.status).toBe("failed");
  });
});
