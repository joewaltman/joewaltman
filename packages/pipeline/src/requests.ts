import { asc, eq, isNull, jobRequests } from "@jw/db";
import { type Job, type JobContext, runJob } from "./runner";
import { STALE_RUNNING_MS } from "./schedule";

export interface RecentRun {
  job: string;
  status: "running" | "success" | "failed";
  startedAt: Date;
}

// Runs the jobs asked for with "Run now" on the admin Jobs page, oldest request first. A job that is
// already running stays queued for the next tick; repeat requests for one job run it once.
export async function runRequestedJobs(ctx: JobContext, jobs: Record<string, Job>, recent: RecentRun[]): Promise<{ ran: Set<string>; failed: number }> {
  const requests = await ctx.db.select().from(jobRequests).where(isNull(jobRequests.startedAt)).orderBy(asc(jobRequests.requestedAt));
  const ran = new Set<string>();
  let failed = 0;
  for (const req of requests) {
    const busy = recent.some((r) => r.job === req.job && r.status === "running" && ctx.now.getTime() - r.startedAt.getTime() < STALE_RUNNING_MS);
    if (busy) continue;
    const job = jobs[req.job];
    if (!job || ran.has(req.job)) {
      await ctx.db.update(jobRequests).set({ startedAt: new Date(), status: job ? "success" : "unknown-job" }).where(eq(jobRequests.id, req.id));
      continue;
    }
    await ctx.db.update(jobRequests).set({ startedAt: new Date() }).where(eq(jobRequests.id, req.id));
    ctx.log(`running ${req.job} (asked for in admin)`);
    const outcome = await runJob(job, { ...ctx, now: new Date() }, 1);
    await ctx.db.update(jobRequests).set({ runId: outcome.runId, status: outcome.status }).where(eq(jobRequests.id, req.id));
    if (outcome.status === "failed") failed++;
    ran.add(req.job);
  }
  return { ran, failed };
}
