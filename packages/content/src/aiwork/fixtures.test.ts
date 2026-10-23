import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import rawRules from "../../../../content/aiwork-rules.json";
import type { Answers } from "../tariff/engine";
import { evaluateAiwork, lawTimeline, questionCountText } from "./engine";
import { aiworkRulesSchema } from "./schema";

const rules = aiworkRulesSchema.parse(rawRules);

// Scenario fixtures in packages/content/fixtures/aiwork: the answers, and the laws the result must show.
interface Fixture {
  name: string;
  answers: Answers;
  laws: string[];
  // Run once for every headcount band, to show size does not change the result.
  everyEmployeeBand?: boolean;
}
const dir = path.join(import.meta.dirname, "../../fixtures/aiwork");
const fixtures: Array<[string, Fixture]> = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Fixture]);
const bands = rules.questions.find((q) => q.id === "employees")!.options!.map((o) => o.value);

describe("AI-at-Work scenario fixtures", () => {
  it("has the four scenarios", () => {
    expect(fixtures.map(([f]) => f)).toEqual([
      "emotion-inference-any-size.json",
      "forty-ats-scheduling-monitoring.json",
      "six-person-no-tools.json",
      "three-hundred-ccpa-ai-screening.json",
    ]);
  });

  for (const [file, fx] of fixtures) {
    it(`${fx.name} (${file})`, () => {
      const runs = fx.everyEmployeeBand ? bands.map((employees) => ({ ...fx.answers, employees })) : [fx.answers];
      for (const answers of runs) {
        const r = evaluateAiwork(answers, rules, "public");
        const laws = [...new Set(r.obligations.map((o) => o.law?.id).filter((id): id is string => Boolean(id)))].sort();
        expect(laws, `laws for employees=${String(answers.employees)}`).toEqual([...fx.laws].sort());
        // Every rule in the result links to its sources, and each link is listed under Sources too.
        const listed = new Set(r.sources.flatMap((s) => s.sources));
        for (const o of r.obligations.filter((x) => x.law)) {
          expect(o.sources!.length, `${o.id} has no source`).toBeGreaterThan(0);
          for (const url of o.sources!) {
            expect(url).toMatch(/^https:\/\//);
            expect(listed.has(url), `${o.id}: ${url} missing from Sources`).toBe(true);
          }
        }
        // Laws the answers did not trigger are named as checked.
        expect([...laws, ...r.notTriggered.map((l) => l.id)].sort()).toEqual(Object.keys(rules.laws).sort());
      }
    });
  }
});

describe("the dated timeline", () => {
  it("groups the laws by start date from the rules file", () => {
    const t = lawTimeline(rules, "2026-10-23");
    expect(t.groups.map((g) => [g.heading, g.laws.map((l) => l.id)])).toEqual([
      ["In force now (since October 1, 2025)", ["crc-ads"]],
      ["January 1, 2027", ["cppa-admt", "ab1883", "ab1331", "sb951"]],
      ["July 1, 2027", ["sb947"]],
    ]);
  });

  it("links every law to its sources and says who it covers where a source does", () => {
    const t = lawTimeline(rules, "2026-10-23");
    for (const law of t.groups.flatMap((g) => g.laws)) expect(law.sources.length, law.id).toBeGreaterThan(0);
    const scope = Object.fromEntries(t.groups.flatMap((g) => g.laws).map((l) => [l.id, l.appliesTo?.text ?? null]));
    expect(scope["crc-ads"]).toContain("5 or more employees");
    expect(scope.sb951).toContain("75 or more employees");
    expect(scope.ab1883).toBeNull();
    // The CCPA threshold shown is the one in the rules file.
    const thresholds = rules.facts["ccpa-thresholds"]!.text;
    for (const figure of scope["cppa-admt"]!.match(/\$?[\d,]{5,}/g)!) expect(thresholds).toContain(figure);
    // SB 947's size is a judgment call, so it carries a footnote.
    expect(t.assumptions.map((a) => a.id)).toEqual(["sb947-size"]);
  });

  it("moves a law into force on its date", () => {
    const t = lawTimeline(rules, "2027-01-01");
    expect(t.groups[0]!.heading).toBe("In force now");
    expect(t.groups[0]!.laws.map((l) => [l.id, l.since])).toEqual([
      ["crc-ads", "2025-10-01"],
      ["cppa-admt", "2027-01-01"],
      ["ab1883", "2027-01-01"],
      ["ab1331", "2027-01-01"],
      ["sb951", "2027-01-01"],
    ]);
    expect(lawTimeline(rules, "2027-07-01").groups).toHaveLength(1);
  });
});

describe("the question count", () => {
  it("matches the form", () => {
    expect(questionCountText(rules)).toBe("Ten questions (eleven if you have 75 or more employees)");
  });

  it("asks the layoff question only of employers with 75 or more, after the headcount question", () => {
    const q = rules.questions.find((x) => x.id === "layoffAi")!;
    expect(q.showWhen).toEqual({ employees: ["75-99", "100-plus"] });
    expect(rules.questions.findIndex((x) => x.id === "employees")).toBeLessThan(rules.questions.indexOf(q));
  });
});

describe("question 8 and SB 947", () => {
  it("maps discipline and termination to SB 947's review and notice, and promotion and pay to its limits", () => {
    const ids = (decisions: string[]) => evaluateAiwork({ employees: "25-74", automatedDecisions: decisions }, rules, "public").obligations.filter((o) => o.law?.id === "sb947").map((o) => o.id).sort();
    expect(ids(["discipline"])).toEqual(["sb947-human", "sb947-limits"]);
    expect(ids(["termination"])).toEqual(["sb947-human", "sb947-limits"]);
    expect(ids(["promotion"])).toEqual(["sb947-limits"]);
    expect(ids(["pay"])).toEqual(["sb947-limits"]);
    expect(ids(["none"])).toEqual([]);
  });
});

describe("reading the form", () => {
  const form = (fields: Record<string, string | string[]>) => ({
    getAll: (name: string) => {
      const v = fields[name];
      return v === undefined ? [] : Array.isArray(v) ? v : [v];
    },
  });
  const rest = { ats: "none", aiScreening: "no", autoScheduling: "no", monitoring: "no", emotionNeural: "no", restroomSurveillance: "no", automatedDecisions: "none", ccpa: "no", aiCommunications: "no" };

  it("requires the layoff answer from employers with 75 or more, and ignores it from everyone else", async () => {
    const { readAnswers } = await import("../tariff/validate");
    expect(readAnswers(rules, form({ ...rest, employees: "100-plus" })).errors).toHaveProperty("layoffAi");
    expect(readAnswers(rules, form({ ...rest, employees: "100-plus", layoffAi: "yes" })).answers.layoffAi).toBe("yes");
    const small = readAnswers(rules, form({ ...rest, employees: "25-74", layoffAi: "yes" }));
    expect(small.errors).toEqual({});
    expect(small.answers.layoffAi).toBeUndefined();
  });
});
