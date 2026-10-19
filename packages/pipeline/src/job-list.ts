import type { ScheduleEntry } from "./schedule";

// Every job by name, with a plain description and when it runs. Plain data, so the website's admin
// Jobs page can import it without pulling in the jobs themselves.
export const JOB_INFO: Record<string, string> = {
  "archive-prune": "Deletes raw downloads older than 60 days",
  "sd-biztax": "City of San Diego business tax certificates",
  abc: "ABC liquor licenses and daily reports",
  cslb: "CSLB contractor license file",
  dca: "DCA board license files (new files monthly)",
  nppes: "CMS weekly NPI file: new healthcare organizations",
  sba: "SBA 7(a) and 504 loan files (new files quarterly)",
  enrich: "Category and one-line summary for new businesses",
  websites: "Website lookup for new businesses",
  courtlistener: "Federal court search for Watchlist customers",
  dockets: "New filings in the court cases you follow",
  "radar-digest": "The New Business Radar email (Mondays)",
  "watchlist-digest": "The Customer Watchlist email (Mondays)",
  "manual-drops": "Reads files uploaded at Drops",
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

// "5:30am daily", "6:00am and 9:00am Mondays", or "when a file is uploaded".
export function whenItRuns(job: string): string {
  const slots = SCHEDULE.filter((s) => s.job === job);
  if (job === "manual-drops") return "When a file is uploaded";
  if (slots.length === 0) return "Only when asked";
  const time = (t: string) => {
    const [h, m] = t.split(":").map(Number) as [number, number];
    return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  };
  const days = slots[0]!.weekdays?.includes(1) && slots[0]!.weekdays.length === 1 ? " Mondays" : " daily";
  return `${slots.map((s) => time(s.time)).join(" and ")}${days}`;
}
