import { abc } from "./adapters/abc";
import { courtListenerJob } from "./adapters/courtlistener";
import { dcaJob } from "./adapters/dca";
import { docketsJob } from "./adapters/dockets";
import { nppesJob } from "./adapters/nppes";
import { sbaJob } from "./adapters/sba";
import { cslb } from "./adapters/cslb";
import { sdBizTax } from "./adapters/sd-biztax";
import { manualDropsJob } from "./drops/job";
import { enrichJob } from "./enrich";
import { radarDigestJob } from "./radar-digest";
import { type Job, adapterJob } from "./runner";
import { type ScheduleEntry, pacificDay } from "./schedule";
import { websitesJob } from "./websites";
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
  nppes: nppesJob(),
  sba: sbaJob(),
  enrich: enrichJob(),
  websites: websitesJob(),
  courtlistener: courtListenerJob(),
  dockets: docketsJob(),
  // Not on the schedule: the tick runs it whenever an uploaded file is waiting.
  "manual-drops": manualDropsJob(),
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
  // CMS posts the weekly NPI file early Monday morning, before the 6:00am Radar.
  { job: "nppes", time: "05:40" },
  // SBA posts quarterly; the daily run only reads the dataset page unless a new file is up.
  { job: "sba", time: "05:40" },
  // After the ingestion jobs, so new businesses are classified before the Monday 6:00am digest.
  { job: "enrich", time: "05:45" },
  // After enrichment: look for each new business's website before the 6:00am Radar.
  { job: "websites", time: "05:47" },
  // Federal court dockets for Watchlist customers, before the Monday 6:15am Watchlist email.
  { job: "courtlistener", time: "05:50" },
  // Court cases Joe follows, such as the IEEPA refund class action (content/watched-dockets.json).
  { job: "dockets", time: "05:55" },
  // Monday only, after the morning ingestion and enrichment.
  { job: "radar-digest", time: "06:00", weekdays: [1] },
  { job: "watchlist-digest", time: "06:15", weekdays: [1] },
  // Catch-up slots: if the early send failed, these try again. Both jobs skip anyone already sent
  // this week, so on a normal Monday they send nothing.
  { job: "radar-digest", time: "09:00", weekdays: [1] },
  { job: "watchlist-digest", time: "09:00", weekdays: [1] },
];
