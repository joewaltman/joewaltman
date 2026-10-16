import { describe, expect, it } from "vitest";
import { type RecentRun, dueJobs, pacificDay, pacificInstant } from "./schedule";

const schedule = [
  { job: "abc", time: "05:30" },
  { job: "cslb", time: "05:30", monthDays: [3] },
];

describe("Pacific time helpers", () => {
  it("handles daylight saving", () => {
    // October is PDT (UTC-7); December is PST (UTC-8).
    expect(pacificInstant("2026-10-16", "05:30").toISOString()).toBe("2026-10-16T12:30:00.000Z");
    expect(pacificInstant("2026-12-16", "05:30").toISOString()).toBe("2026-12-16T13:30:00.000Z");
    // The night clocks fall back (November 1, 2026).
    expect(pacificInstant("2026-11-01", "05:30").toISOString()).toBe("2026-11-01T13:30:00.000Z");
  });
  it("reports the Pacific calendar day", () => {
    expect(pacificDay(new Date("2026-10-17T03:00:00Z"))).toBe("2026-10-16");
  });
});

describe("dueJobs", () => {
  const at = (iso: string) => new Date(iso);

  it("waits for the slot, then runs once", () => {
    expect(dueJobs(at("2026-10-16T12:00:00Z"), schedule, [])).toEqual([]);
    expect(dueJobs(at("2026-10-16T12:31:00Z"), schedule, [])).toEqual([{ job: "abc", attempt: 1 }]);
    const done: RecentRun[] = [{ job: "abc", status: "success", startedAt: at("2026-10-16T12:31:00Z") }];
    expect(dueJobs(at("2026-10-16T13:01:00Z"), schedule, done)).toEqual([]);
  });

  it("retries a failure once, then stops for the day", () => {
    const one: RecentRun[] = [{ job: "abc", status: "failed", startedAt: at("2026-10-16T12:31:00Z") }];
    expect(dueJobs(at("2026-10-16T13:01:00Z"), schedule, one)).toEqual([{ job: "abc", attempt: 2 }]);
    const two: RecentRun[] = [...one, { job: "abc", status: "failed", startedAt: at("2026-10-16T13:01:00Z") }];
    expect(dueJobs(at("2026-10-16T13:31:00Z"), schedule, two)).toEqual([]);
  });

  it("does not start a second copy while one is running, unless it looks stuck", () => {
    const running: RecentRun[] = [{ job: "abc", status: "running", startedAt: at("2026-10-16T12:31:00Z") }];
    expect(dueJobs(at("2026-10-16T13:01:00Z"), schedule, running)).toEqual([]);
    expect(dueJobs(at("2026-10-16T15:01:00Z"), schedule, running)).toEqual([{ job: "abc", attempt: 1 }]);
  });

  it("runs monthly jobs only on their day", () => {
    expect(dueJobs(at("2026-11-03T14:00:00Z"), schedule, []).map((d) => d.job)).toEqual(["abc", "cslb"]);
    expect(dueJobs(at("2026-11-04T14:00:00Z"), schedule, []).map((d) => d.job)).toEqual(["abc"]);
  });

  it("ignores yesterday's runs", () => {
    const yesterday: RecentRun[] = [{ job: "abc", status: "success", startedAt: at("2026-10-15T12:31:00Z") }];
    expect(dueJobs(at("2026-10-16T12:31:00Z"), schedule, yesterday)).toEqual([{ job: "abc", attempt: 1 }]);
  });
});
