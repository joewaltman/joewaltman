const ZONE = "America/Los_Angeles";

function parts(date: Date): Record<string, number> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

// The calendar day in Pacific time, as YYYY-MM-DD.
export function pacificDay(date: Date): string {
  const p = parts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function pacificWeekday(date: Date): number {
  return new Date(`${pacificDay(date)}T12:00:00Z`).getUTCDay();
}

// The instant when it is `time` (HH:MM) Pacific on `day`, whatever the daylight saving offset.
export function pacificInstant(day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess));
    const shown = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
    guess += wall - shown;
  }
  return new Date(guess);
}

export interface ScheduleEntry {
  job: string;
  // Pacific time, HH:MM.
  time: string;
  // Days of the month to run (1 to 28). Omit to run every day.
  monthDays?: number[];
  // Days of the week to run (0 is Sunday). Omit to run every day.
  weekdays?: number[];
}

export interface RecentRun {
  job: string;
  status: "running" | "success" | "failed";
  startedAt: Date;
}

export const MAX_ATTEMPTS_PER_SLOT = 2;
export const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

// Jobs whose slot today has passed and that have not succeeded since, with a cap on retries.
export function dueJobs(now: Date, schedule: ScheduleEntry[], recent: RecentRun[]): Array<{ job: string; attempt: number }> {
  const day = pacificDay(now);
  const dayOfMonth = Number(day.slice(8, 10));
  const weekday = pacificWeekday(now);
  const due: Array<{ job: string; attempt: number }> = [];
  for (const entry of schedule) {
    if (entry.monthDays && !entry.monthDays.includes(dayOfMonth)) continue;
    if (entry.weekdays && !entry.weekdays.includes(weekday)) continue;
    const slot = pacificInstant(day, entry.time);
    if (now < slot) continue;
    const since = recent.filter((r) => r.job === entry.job && r.startedAt >= slot);
    if (since.some((r) => r.status === "success")) continue;
    if (since.some((r) => r.status === "running" && now.getTime() - r.startedAt.getTime() < STALE_RUNNING_MS)) continue;
    const failures = since.filter((r) => r.status === "failed").length;
    if (failures >= MAX_ATTEMPTS_PER_SLOT) continue;
    due.push({ job: entry.job, attempt: failures + 1 });
  }
  return due;
}
