import { sdBizTax } from "./adapters/sd-biztax";
import { enrichJob } from "./enrich";
import { type Job, adapterJob } from "./runner";
import { type ScheduleEntry, pacificDay } from "./schedule";

export const ARCHIVE_DAYS = 60;

const archivePrune: Job = {
  name: "archive-prune",
  async run(ctx) {
    const cutoff = pacificDay(new Date(ctx.now.getTime() - ARCHIVE_DAYS * 86_400_000));
    const removed = await ctx.archive.prune(cutoff);
    return { rowsIn: 0, rowsUpserted: 0, events: 0, meta: { cutoff, removed, archive: ctx.archive.kind } };
  },
};

export const JOBS: Record<string, Job> = {
  "archive-prune": archivePrune,
  "sd-biztax": adapterJob(sdBizTax),
  enrich: enrichJob(),
};

// Pacific time. The city rebuilds its files around 2:07am Pacific, so 5:30am is safely after.
export const SCHEDULE: ScheduleEntry[] = [
  { job: "archive-prune", time: "04:00" },
  { job: "sd-biztax", time: "05:30" },
  // After the ingestion jobs, so new businesses are classified before the Monday 6:00am digest.
  { job: "enrich", time: "05:45" },
];
