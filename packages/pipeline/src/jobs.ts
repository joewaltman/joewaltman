import { abc } from "./adapters/abc";
import { courtListenerJob } from "./adapters/courtlistener";
import { dcaJob } from "./adapters/dca";
import { cslb } from "./adapters/cslb";
import { sdBizTax } from "./adapters/sd-biztax";
import { enrichJob } from "./enrich";
import { radarDigestJob } from "./radar-digest";
import { type Job, adapterJob } from "./runner";
import { type ScheduleEntry, pacificDay } from "./schedule";
import { watchlistDigestJob } from "./watchlist/digest";

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
  abc: adapterJob(abc),
  cslb: adapterJob(cslb),
  dca: dcaJob(),
  enrich: enrichJob(),
  courtlistener: courtListenerJob(),
  "radar-digest": radarDigestJob(),
  "watchlist-digest": watchlistDigestJob(),
};

// Pacific time. The city rebuilds its files around 2:07am Pacific, so 5:30am is safely after.
export const SCHEDULE: ScheduleEntry[] = [
  { job: "archive-prune", time: "04:00" },
  { job: "sd-biztax", time: "05:30" },
  { job: "abc", time: "05:30" },
  // The CSLB file regenerates daily; running daily catches bond and status changes within a day.
  { job: "cslb", time: "05:30" },
  // DCA posts new files once a month; the daily run only checks the Box folder and reads changed boards.
  { job: "dca", time: "05:35" },
  // After the ingestion jobs, so new businesses are classified before the Monday 6:00am digest.
  { job: "enrich", time: "05:45" },
  // Federal court dockets for Watchlist customers, before the Monday 6:15am Watchlist email.
  { job: "courtlistener", time: "05:50" },
  // Monday only, after the morning ingestion and enrichment.
  { job: "radar-digest", time: "06:00", weekdays: [1] },
  { job: "watchlist-digest", time: "06:15", weekdays: [1] },
];
