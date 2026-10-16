import { getDb, gt, jobRuns } from "@jw/db";
import { loadEmailConfig } from "@jw/email";
import { archiveFromEnv } from "./archive";
import { JOBS, SCHEDULE } from "./jobs";
import { type JobContext, runJob } from "./runner";
import { dueJobs } from "./schedule";

// Usage:
//   pnpm pipeline run <job>   run one job now
//   pnpm pipeline tick        run whatever the schedule says is due (the Railway cron calls this)
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

  if (command === "tick") {
    const ctx = context();
    const recent = await ctx.db
      .select({ job: jobRuns.job, status: jobRuns.status, startedAt: jobRuns.startedAt })
      .from(jobRuns)
      .where(gt(jobRuns.startedAt, new Date(ctx.now.getTime() - 2 * 86_400_000)));
    const due = dueJobs(ctx.now, SCHEDULE, recent);
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

  console.error("Usage: pipeline run <job> | tick | list");
  return 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
