import { getDb, gt, jobRuns } from "@jw/db";
import { loadEmailConfig } from "@jw/email";
import { archiveFromEnv } from "./archive";
import { pendingDrops } from "./drops/job";
import { JOBS, SCHEDULE } from "./jobs";
import { type JobContext, markInterrupted, runJob } from "./runner";
import { STALE_RUNNING_MS, dueJobs } from "./schedule";

// Usage:
//   pnpm pipeline run <job>   run one job now
//   pnpm pipeline tick        run whatever the schedule says is due, once
//   pnpm pipeline worker      check the schedule every 30 minutes (the Railway worker service runs this)
//   pnpm pipeline list        show jobs and the schedule

function context(): JobContext {
  const db = getDb();
  return {
    db,
    archive: archiveFromEnv(),
    email: { db, config: loadEmailConfig() },
    now: new Date(),
    fetch: (url, init) => fetch(url, init),
    log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
  };
}

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);

  if (command === "list") {
    for (const name of Object.keys(JOBS)) {
      const slot = SCHEDULE.find((s) => s.job === name);
      console.log(`${name.padEnd(16)} ${slot ? `${slot.time} Pacific${slot.monthDays ? ` on day ${slot.monthDays.join(",")}` : " daily"}` : "manual only"}`);
    }
    return 0;
  }

  if (command === "run") {
    const job = arg ? JOBS[arg] : undefined;
    if (!job) {
      console.error(`Unknown job "${arg ?? ""}". Jobs: ${Object.keys(JOBS).join(", ")}`);
      return 2;
    }
    const ctx = context();
    ctx.log(`archive: ${ctx.archive.kind}`);
    return (await runJob(job, ctx)).status === "success" ? 0 : 1;
  }

  if (command === "worker") {
    // Long-running form of tick for the Railway worker service: check the schedule now, then every 30 minutes.
    let stopping = false;
    const stop = () => {
      stopping = true;
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    while (!stopping) {
      await tick().catch((err) => console.error("tick failed", err));
      for (let waited = 0; waited < TICK_MS && !stopping; waited += 1000) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return 0;
  }

  if (command === "tick") {
    return tick();
  }

  console.error("Usage: pipeline run <job> | tick | worker | list");
  return 2;
}

const TICK_MS = 30 * 60 * 1000;

async function tick(): Promise<number> {
  const ctx = context();
  const interrupted = await markInterrupted(ctx.db, ctx.now);
  if (interrupted > 0) ctx.log(`marked ${interrupted} interrupted run(s) as failed`);
  const recent = await ctx.db
    .select({ job: jobRuns.job, status: jobRuns.status, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(gt(jobRuns.startedAt, new Date(ctx.now.getTime() - 2 * 86_400_000)));
  const due = dueJobs(ctx.now, SCHEDULE, recent);
  // Uploaded files are read on the next tick after they arrive, not at a fixed time.
  const dropsRunning = recent.some((r) => r.job === "manual-drops" && r.status === "running" && ctx.now.getTime() - r.startedAt.getTime() < STALE_RUNNING_MS);
  if (!dropsRunning && (await pendingDrops(ctx.db)) > 0) due.push({ job: "manual-drops", attempt: 1 });
  if (due.length === 0) {
    ctx.log("nothing due");
    return 0;
  }
  let failed = 0;
  for (const { job, attempt } of due) {
    ctx.log(`running ${job} (attempt ${attempt})`);
    const outcome = await runJob(JOBS[job]!, { ...ctx, now: new Date() }, attempt);
    if (outcome.status === "failed") failed++;
  }
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
