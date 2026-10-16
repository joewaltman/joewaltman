import { type Db, type Source, and, eq, jobRuns, lt } from "@jw/db";
import { type SendDeps, jobFailed, sendEmail } from "@jw/email";
import { type Archive, archiveKey } from "./archive";
import { STALE_RUNNING_MS, pacificDay } from "./schedule";

export interface FetchedFile {
  name: string;
  url: string;
  body: Uint8Array;
}

export interface JobContext {
  db: Db;
  archive: Archive;
  email: SendDeps;
  now: Date;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  log: (message: string) => void;
}

export interface JobResult {
  rowsIn: number;
  rowsUpserted: number;
  events: number;
  meta?: Record<string, unknown>;
}

export interface Job {
  name: string;
  run(ctx: JobContext): Promise<JobResult>;
}

// The shape every source module follows: download, turn files into records, write them.
export interface Adapter<R> {
  name: string;
  source: Source;
  fetch(ctx: JobContext): Promise<FetchedFile[]>;
  parse(files: FetchedFile[], ctx: JobContext): R[] | Promise<R[]>;
  upsert(records: R[], ctx: JobContext): Promise<{ rowsUpserted: number; events: number; meta?: Record<string, unknown> }>;
}

export function adapterJob<R>(adapter: Adapter<R>): Job {
  return {
    name: adapter.name,
    async run(ctx) {
      const files = await adapter.fetch(ctx);
      const day = pacificDay(ctx.now);
      const archived: string[] = [];
      for (const f of files) archived.push(await ctx.archive.put(archiveKey(adapter.source, day, f.name), f.body));
      const records = await adapter.parse(files, ctx);
      ctx.log(`${adapter.name}: ${records.length} records from ${files.length} file(s)`);
      const result = await adapter.upsert(records, ctx);
      return {
        rowsIn: records.length,
        rowsUpserted: result.rowsUpserted,
        events: result.events,
        meta: { ...result.meta, archived, files: files.map((f) => ({ name: f.name, url: f.url, bytes: f.body.length })) },
      };
    },
  };
}

export async function download(ctx: JobContext, url: string, name: string, init?: RequestInit): Promise<FetchedFile> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ctx.fetch(url, {
        ...init,
        headers: { "User-Agent": "joewaltman.com public-records pipeline (joe@joewaltman.com)", ...init?.headers },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
      return { name, url, body: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) {
      lastError = err;
      ctx.log(`download attempt ${attempt} failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

export interface RunOutcome {
  status: "success" | "failed";
  runId: string;
  result?: JobResult;
  error?: string;
}

// Runs one job with a job_runs row around it. A failure is recorded and emailed to Joe, never swallowed.
export async function runJob(job: Job, ctx: JobContext, attempt = 1): Promise<RunOutcome> {
  const [row] = await ctx.db
    .insert(jobRuns)
    .values({ job: job.name, status: "running", startedAt: ctx.now })
    .returning({ id: jobRuns.id });
  const runId = row!.id;
  try {
    const result = await job.run(ctx);
    await ctx.db
      .update(jobRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        rowsIn: result.rowsIn,
        rowsUpserted: result.rowsUpserted,
        meta: { ...result.meta, events: result.events },
      })
      .where(eq(jobRuns.id, runId));
    ctx.log(`${job.name}: ok, ${result.rowsUpserted} upserted, ${result.events} new events`);
    return { status: "success", runId, result };
  } catch (err) {
    const error = err instanceof Error ? `${err.message}\n${(err.stack ?? "").split("\n").slice(1, 6).join("\n")}` : String(err);
    await ctx.db
      .update(jobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: error.slice(0, 4000) })
      .where(eq(jobRuns.id, runId));
    ctx.log(`${job.name}: FAILED ${error}`);
    await sendEmail(ctx.email, {
      to: ctx.email.config.adminEmail,
      template: jobFailed({
        job: job.name,
        error: error.slice(0, 2000),
        startedAt: ctx.now.toISOString(),
        attempt,
        adminUrl: `${ctx.email.config.siteUrl}/admin/jobs`,
      }),
      reason: "You got this because an ingestion job on joewaltman.com failed.",
      bypassSuppression: true,
    }).catch((mailErr) => ctx.log(`could not send failure email: ${String(mailErr)}`));
    return { status: "failed", runId, error };
  }
}

// A run still marked running long after it started was cut off (a redeploy or a crash killed the
// container). Mark it failed so admin shows it and the scheduler counts it as an attempt.
export async function markInterrupted(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(jobRuns)
    .set({ status: "failed", finishedAt: now, error: "Interrupted: the run never recorded a finish (redeploy or crash)." })
    .where(and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, new Date(now.getTime() - STALE_RUNNING_MS))))
    .returning({ id: jobRuns.id });
  return rows.length;
}
