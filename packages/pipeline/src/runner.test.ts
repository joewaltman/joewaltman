import { type Db, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage, SendDeps } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { archiveKey, memoryArchive } from "./archive";
import { type Adapter, type JobContext, adapterJob, runJob } from "./runner";

let db: Db;
let sent: OutgoingMessage[];
let ctx: JobContext;
let archive: ReturnType<typeof memoryArchive>;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  archive = memoryArchive();
  const email: SendDeps = {
    db,
    transport: {
      async send(m) {
        sent.push(m);
        return { id: "x" };
      },
    },
    config: {
      mode: "joe-only",
      adminEmail: "joe@joewaltman.com",
      from: "Joe Waltman <joe@joewaltman.com>",
      replyTo: "joe@joewaltman.com",
      siteUrl: "https://joewaltman.com",
      postalAddress: "PO Box 1",
      resendApiKey: null,
      dryRunDir: "/tmp/unused",
    },
  };
  ctx = {
    db,
    archive,
    email,
    now: new Date("2026-10-16T12:30:00Z"),
    fetch: async () => new Response("unused"),
    log: () => {},
  };
});

const adapter = (fail: boolean): Adapter<string> => ({
  name: "demo",
  source: "abc",
  async fetch() {
    return [{ name: "export.csv", url: "https://example.test/export.csv", body: new TextEncoder().encode("a\nb\n") }];
  },
  parse(files) {
    if (fail) throw new Error("column LICENSE_NUMBER missing; the source changed its format");
    return new TextDecoder().decode(files[0]!.body).trim().split("\n");
  },
  async upsert(records) {
    return { rowsUpserted: records.length, events: 1 };
  },
});

describe("runJob", () => {
  it("archives the download and records a successful run", async () => {
    const out = await runJob(adapterJob(adapter(false)), ctx);
    expect(out.status).toBe("success");
    expect(archive.keys).toEqual(["abc/2026-10-16/export.csv.gz"]);
    const [row] = await db.select().from(jobRuns);
    expect(row).toMatchObject({ job: "demo", status: "success", rowsIn: 2, rowsUpserted: 2 });
    expect(row!.meta).toMatchObject({ events: 1, archived: ["abc/2026-10-16/export.csv.gz"] });
    expect(sent).toHaveLength(0);
  });

  it("records a failure and emails Joe", async () => {
    const out = await runJob(adapterJob(adapter(true)), ctx, 2);
    expect(out.status).toBe("failed");
    const [row] = await db.select().from(jobRuns);
    expect(row!.status).toBe("failed");
    expect(row!.error).toContain("source changed its format");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("joe@joewaltman.com");
    expect(sent[0]!.subject).toBe("Ingestion job failed: demo");
    expect(sent[0]!.text).toContain("attempt 2 today");
  });
});

describe("archiveKey", () => {
  it("gzips plain files and keeps compressed ones as they are", () => {
    expect(archiveKey("abc", "2026-10-16", "DailyExport-CSV.zip")).toBe("abc/2026-10-16/DailyExport-CSV.zip");
    expect(archiveKey("sd_biztax", "2026-10-16", "listings active.csv")).toBe("sd_biztax/2026-10-16/listings_active.csv.gz");
  });
  it("prunes by the date folder", async () => {
    await archive.put("abc/2026-08-01/a.csv.gz", new Uint8Array());
    await archive.put("abc/2026-10-16/b.csv.gz", new Uint8Array());
    expect(await archive.prune("2026-08-17")).toBe(1);
    expect(archive.keys).toEqual(["abc/2026-10-16/b.csv.gz"]);
  });
});
