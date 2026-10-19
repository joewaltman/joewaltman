import { type Db, jobRequests, jobRuns } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "./archive";
import { JOB_INFO, SCHEDULE, whenItRuns } from "./job-list";
import { JOBS } from "./jobs";
import { runRequestedJobs } from "./requests";
import type { Job, JobContext } from "./runner";

let db: Db;
let calls: string[];
const job = (name: string, fail = false): Job => ({
  name,
  async run() {
    calls.push(name);
    if (fail) throw new Error("boom");
    return { rowsIn: 0, rowsUpserted: 0, events: 0 };
  },
});
const ctx = (): JobContext => ({
  db,
  archive: memoryArchive(),
  now: new Date("2026-10-19T16:20:00Z"),
  log: () => {},
  fetch: async () => new Response(""),
  email: { db, config: { mode: "dryrun", adminEmail: "joewaltman@gmail.com", from: "x <x@x.com>", replyTo: "x@x.com", siteUrl: "https://joewaltman.com", postalAddress: null, resendApiKey: null, dryRunDir: "/tmp/jw-test-dryrun" } },
});

beforeEach(async () => {
  db = await createTestDb();
  calls = [];
});

describe("run now requests", () => {
  it("runs each requested job once, records the outcome, and leaves busy jobs queued", async () => {
    await db.insert(jobRequests).values([{ job: "dockets" }, { job: "dockets" }, { job: "cslb" }, { job: "nope" }, { job: "abc" }]);
    const jobs = { dockets: job("dockets"), cslb: job("cslb", true), abc: job("abc") };
    const recent = [{ job: "abc", status: "running" as const, startedAt: new Date("2026-10-19T16:10:00Z") }];
    const out = await runRequestedJobs(ctx(), jobs, recent);
    expect(calls).toEqual(["dockets", "cslb"]);
    expect(out).toMatchObject({ failed: 1 });
    expect([...out.ran].sort()).toEqual(["cslb", "dockets"]);
    const reqs = await db.select().from(jobRequests);
    expect(reqs.filter((r) => r.job === "dockets").map((r) => r.status).sort()).toEqual(["success", "success"]);
    expect(reqs.find((r) => r.job === "cslb")!.status).toBe("failed");
    expect(reqs.find((r) => r.job === "nope")!.status).toBe("unknown-job");
    expect(reqs.find((r) => r.job === "abc")!.startedAt).toBeNull();
    expect((await db.select().from(jobRuns)).map((r) => r.job).sort()).toEqual(["cslb", "dockets"]);
  });
});

describe("job list", () => {
  it("describes every job and schedules only real jobs", () => {
    expect(Object.keys(JOB_INFO).sort()).toEqual(Object.keys(JOBS).sort());
    for (const s of SCHEDULE) expect(JOBS[s.job]).toBeDefined();
    expect(whenItRuns("cslb")).toBe("5:30am daily");
    expect(whenItRuns("radar-digest")).toBe("6:00am and 9:00am Mondays");
    expect(whenItRuns("manual-drops")).toBe("When a file is uploaded");
  });
});
