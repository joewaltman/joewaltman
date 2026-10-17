import { describe, expect, it } from "vitest";
import rawRules from "../../../../content/aiwork-rules.json";
import type { Answers } from "../tariff/engine";
import { evaluateAiwork, obligationGroups, templateText } from "./engine";
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
  ["auto-scheduling only", { autoScheduling: "yes" }, ["crc-accommodation", "crc-records"]],
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
    expect(JSON.stringify(rawRules)).not.toMatch(/—/);
  });

  it("keeps facts beyond Appendix A marked verify until an attorney confirms them", () => {
    const verified = Object.entries(rules.facts).filter(([, f]) => !f.verify).map(([id]) => id).sort();
    expect(verified).toEqual(["ccpa-thresholds", "cppa-admt-compliance", "cppa-risk-assessments", "crc-ads-effective", "new-laws-signed", "sb947-effective"]);
    for (const f of Object.values(rules.facts)) if (!f.verify) expect(f.sources.length).toBeGreaterThan(0);
  });

  it("shows visitors only obligations whose facts are all confirmed, and says which were held back", () => {
    const r = evaluateAiwork({ ...base, aiScreening: "yes", ccpa: "not-sure" }, rules, "public");
    expect(r.obligations.map((o) => o.id)).toEqual(["ccpa-check"]);
    expect(r.hidden.sort()).toEqual(["cppa-admt", "crc-accommodation", "crc-bias", "crc-records"]);
    expect(r.sources.every((s) => !s.verify)).toBe(true);
  });

  it("offers templates as text files, held back from visitors until their facts are confirmed", () => {
    expect(templateText(rules, "sb947-post-use-notice", "public")).toBeNull();
    const t = templateText(rules, "sb947-post-use-notice", "admin")!;
    expect(t.fileName).toBe("notice-after-automated-decision.txt");
    expect(t.text).toContain("relied primarily on an automated decision system");
    expect(t.text).toContain("Information, not legal advice.");
    expect(templateText(rules, "nope", "admin")).toBeNull();
  });
});
