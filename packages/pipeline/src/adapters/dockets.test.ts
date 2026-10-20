import { type Db, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "../archive";
import { type JobContext, runJob } from "../runner";
import { docketsJob, readEntries } from "./dockets";

// Shaped like CourtListener's v4 docket-entries response (descriptions are made up).
const page = (ids: number[]) => ({
  count: ids.length,
  next: null,
  previous: null,
  results: ids.map((id, i) => ({
    id,
    entry_number: 100 + id,
    date_filed: `2026-10-${String(10 + i).padStart(2, "0")}`,
    description: id === 3 ? "" : `ORDER on schedule (entry ${id})`,
    recap_documents: [{ description: id === 3 ? "Joint status report" : "", document_number: "1" }],
  })),
});

describe("readEntries", () => {
  it("takes the entry description, or the first document's when the entry has none", () => {
    expect(readEntries(page([3, 2]))).toEqual([
      { id: 3, entryNumber: "103", dateFiled: "2026-10-10", text: "Joint status report" },
      { id: 2, entryNumber: "102", dateFiled: "2026-10-11", text: "ORDER on schedule (entry 2)" },
    ]);
  });
});

describe("dockets job", () => {
  let db: Db;
  let sent: OutgoingMessage[];
  let entries: number[];
  let auth: string | null;
  beforeEach(async () => {
    db = await createTestDb();
    sent = [];
    entries = [2, 1];
  });
  let day = 20;
  const ctx = (): JobContext => ({
    db,
    archive: memoryArchive(),
    now: new Date(`2026-10-${day++}T12:52:00Z`),
    log: () => {},
    fetch: async (_url, init) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify(page(entries)));
    },
    email: {
      db,
      transport: { async send(m) { sent.push(m); return { id: "x" }; } },
      config: { mode: "live", adminEmail: "joewaltman@gmail.com", from: "Joe Waltman <joe@joewaltman.com>", replyTo: "joe@joewaltman.com", siteUrl: "https://joewaltman.com", postalAddress: "PO Box 1, Encinitas, CA 92024", resendApiKey: null, dryRunDir: "/tmp/unused" },
    },
  });

  it("notes what is there on the first run, then emails only new filings", async () => {
    expect((await runJob(docketsJob(() => "tok"), ctx())).status).toBe("success");
    expect(auth).toBe("Token tok");
    expect(sent).toHaveLength(0);
    entries = [4, 3, 2, 1];
    await runJob(docketsJob(() => "tok"), ctx());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("2 new filings in Freestyle World, Inc. v. United States");
    expect(sent[0]!.text).toContain("ORDER on schedule (entry 4)");
    expect(sent[0]!.text).toContain("Joint status report");
    expect(sent[0]!.text).toContain("tariff-rules.json");
    await runJob(docketsJob(() => "tok"), ctx());
    expect(sent).toHaveLength(1);
  });

  it("waits once when CourtListener asks it to slow down", async () => {
    const waits: number[] = [];
    let first = true;
    const slow = { ...ctx(), fetch: async () => {
      if (first) {
        first = false;
        return new Response("slow down", { status: 429, headers: { "Retry-After": "7" } });
      }
      return new Response(JSON.stringify(page(entries)));
    } };
    expect((await runJob(docketsJob(() => "tok", async (ms) => void waits.push(ms)), slow)).status).toBe("success");
    expect(waits).toEqual([7000]);
  });

  it("fails clearly without the API key", async () => {
    const out = await runJob(docketsJob(() => null), { ...ctx(), email: { ...ctx().email, config: { ...ctx().email.config, mode: "dryrun" } } });
    expect(out.status).toBe("failed");
    const [run] = await db.select().from(jobRuns);
    expect(run!.error).toMatch(/COURTLISTENER_API_TOKEN is not set/);
  });
});
