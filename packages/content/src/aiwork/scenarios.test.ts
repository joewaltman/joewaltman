import { describe, expect, it } from "vitest";
import rawRules from "../../../../content/aiwork-rules.json";
import type { Answers } from "../tariff/engine";
import { evaluateAiwork, obligationGroups, templateText, upcomingLaws } from "./engine";
import { aiworkRulesSchema, checkAiworkReferences } from "./schema";

const rules = aiworkRulesSchema.parse(rawRules);

// Every answer "no" unless a scenario says otherwise.
const base: Answers = {
  employees: "25-74",
  ats: ["none"],
  aiScreening: "no",
  autoScheduling: "no",
  monitoring: "no",
  emotionNeural: "no",
  restroomSurveillance: "no",
  automatedDecisions: ["none"],
  ccpa: "no",
  aiCommunications: "no",
};
const ids = (answers: Answers) => evaluateAiwork({ ...base, ...answers }, rules, "admin").obligations.map((o) => o.id).sort();

// The ten scenarios from the spec's "done when". Expected lists are sorted.
const SCENARIOS: Array<[string, Answers, string[]]> = [
  ["a small shop with no automated tools", { employees: "5-24" }, []],
  ["fewer than five employees using AI screening: FEHA rules do not reach them", { employees: "under-5", aiScreening: "yes" }, []],
  ["AI resume screening at a 30-person company", { aiScreening: "yes", ats: ["greenhouse"] }, ["crc-accommodation", "crc-bias", "crc-records"]],
  ["auto-scheduling only", { autoScheduling: "yes" }, ["crc-records"]],
  ["CCPA business using AI screening", { aiScreening: "yes", ccpa: "yes" }, ["cppa-admt", "crc-accommodation", "crc-bias", "crc-records"]],
  ["not sure about the CCPA, with automated pay decisions", { ccpa: "not-sure", automatedDecisions: ["pay"] }, ["ccpa-check", "cppa-admt", "crc-bias", "crc-records", "sb947-limits"]],
  ["automated termination input", { automatedDecisions: ["termination"] }, ["crc-bias", "crc-records", "sb947-human", "sb947-limits"]],
  ["emotion-reading tools and bathroom coverage", { emotionNeural: "yes", restroomSurveillance: "yes", monitoring: "yes" }, ["ab1331-bathrooms", "ab1883-stop", "sb947-limits"]],
  ["150 employees with productivity monitoring", { employees: "100-plus", monitoring: "yes" }, ["sb947-limits", "sb951-warn"]],
  ["unsure on everything", { aiScreening: "not-sure", autoScheduling: "not-sure", monitoring: "not-sure", emotionNeural: "not-sure", restroomSurveillance: "not-sure", automatedDecisions: ["not-sure"], ccpa: "not-sure", aiCommunications: "not-sure" }, ["ab1331-bathrooms", "ab1883-stop", "ccpa-check", "cppa-admt", "crc-accommodation", "crc-bias", "crc-records", "sb947-human", "sb947-limits"]],
];

describe("AI-at-Work scenarios", () => {
  for (const [name, answers, expected] of SCENARIOS) {
    it(name, () => expect(ids(answers)).toEqual(expected));
  }

  it("marks obligations that only a \"not sure\" answer triggered, with what to check", () => {
    const r = evaluateAiwork({ ...base, aiScreening: "not-sure" }, rules, "admin");
    const records = r.obligations.find((o) => o.id === "crc-records")!;
    expect(records.uncertain).toBe(true);
    expect(records.checkFirst).toMatch(/Ask your vendors/);
    const sure = evaluateAiwork({ ...base, aiScreening: "yes" }, rules, "admin").obligations.find((o) => o.id === "crc-records")!;
    expect(sure).toMatchObject({ uncertain: false, checkFirst: null });
  });

  it("dates each obligation and lists the laws nothing triggered", () => {
    const r = evaluateAiwork({ ...base, aiScreening: "yes", ccpa: "yes", automatedDecisions: ["discipline"], aiCommunications: "yes" }, rules, "admin");
    expect(obligationGroups(r, "2026-10-17").map((g) => g.heading)).toEqual([
      "In effect now (since October 1, 2025)",
      "By January 1, 2027",
      "By July 1, 2027",
      "Good practice",
    ]);
    expect(r.notTriggered.map((l) => l.id).sort()).toEqual(["ab1331", "ab1883", "sb951"]);
  });
});

describe("the rules file", () => {
  it("cross-references cleanly and has no em dashes", () => {
    expect(checkAiworkReferences(rules)).toEqual([]);
    expect(JSON.stringify(rawRules)).not.toMatch(/\u2014/);
  });

  it("backs every statement in use with a source, and marks each judgment call as an assumption", () => {
    for (const f of Object.values(rules.facts)) {
      expect(f.verify).toBe(false);
      expect(f.sources.length).toBeGreaterThan(0);
    }
    expect(Object.entries(rules.facts).filter(([, f]) => f.assumption).map(([id]) => id).sort()).toEqual([
      "ab1331-rules",
      "ab1883-biometrics",
      "ads-scheduling",
      "cppa-admt-scope",
      "feha-five",
      "sb947-notice",
      "sb947-rules",
      "sb947-size",
      "vendor-features-ads",
    ]);
    expect(rules.review.launchedWithoutReview).toBe("2026-10-17");
  });

  it("numbers footnotes in reading order and lists each assumption once", () => {
    const r = evaluateAiwork({ ...base, aiScreening: "yes", automatedDecisions: ["termination"] }, rules, "public");
    const records = r.obligations.find((o) => o.id === "crc-records")!;
    expect(records.summary[0]!.notes).toEqual([1]);
    expect(r.assumptions.map((a) => a.id)).toEqual(["ads-scheduling", "feha-five", "sb947-rules", "sb947-size", "sb947-notice"]);
    expect(r.obligations.find((o) => o.id === "sb947-human")!.summary[0]!.notes).toEqual([3, 4]);
  });

  it("holds back from visitors any obligation resting on a statement marked verify", () => {
    const unsure = { ...rules, facts: { ...rules.facts, "sb947-rules": { ...rules.facts["sb947-rules"]!, verify: true } } };
    const r = evaluateAiwork({ ...base, automatedDecisions: ["termination"] }, unsure, "public");
    expect(r.hidden).toEqual(["sb947-human"]);
    expect(r.obligations.map((o) => o.id)).toEqual(["crc-records", "crc-bias", "sb947-limits"]);
    expect(evaluateAiwork({ ...base, automatedDecisions: ["termination"] }, rules, "public").hidden).toEqual([]);
  });

  it("offers templates as text files with the caveat attached", () => {
    const t = templateText(rules, "sb947-post-use-notice", "public")!;
    expect(t.fileName).toBe("notice-after-automated-decision.txt");
    expect(t.text).toContain("relied primarily on an automated decision system");
    expect(t.text).toContain("Information, not legal advice. Not reviewed by an attorney.");
    expect(templateText(rules, "nope", "admin")).toBeNull();
  });
});

describe("the January 1 headline", () => {
  it("names the laws that start next, from the rules file", () => {
    const next = upcomingLaws(rules, "2026-10-21")!;
    expect(next.headline).toBe("Four California rules on AI at work start January 1, 2027");
    expect(next.laws.map((l) => l.id)).toEqual(["cppa-admt", "ab1883", "ab1331", "sb951"]);
    expect(next.laws.every((l) => l.short)).toBe(true);
  });

  it("moves on to the next date once a date passes, and goes away when every law is in effect", () => {
    expect(upcomingLaws(rules, "2027-01-01")!.headline).toBe("One California rule on AI at work starts July 1, 2027");
    expect(upcomingLaws(rules, "2027-07-01")).toBeNull();
  });
});

describe("hiring system notes", () => {
  it("covers every system in question 2", () => {
    const options = rules.questions.find((q) => q.id === "ats")!.options!.map((o) => o.value).filter((v) => v !== "none");
    expect(Object.keys(rules.vendors.systems).sort()).toEqual([...options].sort());
  });

  it("adds notes for the systems picked, after the obligations' footnotes", () => {
    const r = evaluateAiwork({ ...base, ats: ["other"], automatedDecisions: ["termination"] }, rules, "public");
    expect(r.vendors!.systems.map((v) => v.id)).toEqual(["other"]);
    expect(r.vendors!.answeredNo).toContain("question 3");
    // The vendor intro's assumption comes last, after the five the obligations cite.
    expect(r.assumptions.map((a) => a.id).at(-1)).toBe("vendor-features-ads");
    expect(r.vendors!.intro[0]!.notes).toEqual([6]);
    expect(r.sources.map((s) => s.id)).toContain("crc-agents");
  });

  it("leaves the section out when no system is picked, and drops the nudge when the answer is yes", () => {
    expect(evaluateAiwork(base, rules, "public").vendors).toBeNull();
    expect(evaluateAiwork({ ...base, ats: ["other"], aiScreening: "yes" }, rules, "public").vendors!.answeredNo).toBeNull();
  });

  it("mentions the CCPA rules only when the CCPA may apply", () => {
    const line = (ccpa: string) => evaluateAiwork({ ...base, ats: ["other"], ccpa }, rules, "public").vendors!.intro.some((l) => l.text.includes("CCPA"));
    expect([line("no"), line("yes"), line("not-sure")]).toEqual([false, true, true]);
  });
});
