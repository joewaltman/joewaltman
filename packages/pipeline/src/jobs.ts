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
import { pacificDay } from "./schedule";
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

export { SCHEDULE } from "./job-list";
