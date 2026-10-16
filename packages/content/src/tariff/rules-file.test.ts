import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tariffRules } from "../index";
import { evaluateTariff } from "./engine";
import { checkReferences } from "./schema";

const raw = readFileSync(new URL("../../../../content/tariff-rules.json", import.meta.url), "utf8");

describe("content/tariff-rules.json", () => {
  it("parses and every reference resolves", () => {
    expect(checkReferences(tariffRules)).toEqual([]);
  });

  it("has no em dashes", () => {
    expect(raw).not.toMatch(/\u2014/);
  });

  it("gives every fact an as-of date, and a source unless it is marked verify", () => {
    for (const [id, f] of Object.entries(tariffRules.facts)) {
      expect(f.asOf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (!f.verify) expect(f.sources.length, id).toBeGreaterThan(0);
    }
  });

  it("never shows an unverified fact to the public on any path", () => {
    for (const pathId of Object.keys(tariffRules.paths)) {
      // Force each path through the fallback so every path gets rendered.
      const rules = { ...tariffRules, rules: [], fallbackPath: pathId };
      const result = evaluateTariff({}, rules, "public");
      const shown = [
        ...result.path.summary,
        ...result.path.steps,
        ...result.path.documents,
        ...result.path.deadlines,
      ];
      for (const item of shown) {
        for (const f of item.facts) expect(tariffRules.facts[f]!.verify, `${pathId}: ${f}`).toBe(false);
      }
      for (const s of result.sources) expect(s.verify, `${pathId}: ${s.id}`).toBe(false);
      expect(result.path.summary.length, `${pathId} needs a public summary`).toBeGreaterThan(0);
    }
  });

  it("uses only question options that exist", () => {
    // checkReferences covers rule and action conditions; this guards the question list itself.
    const ids = tariffRules.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tariffRules.questions.filter((q) => q.number <= 10)).toHaveLength(10);
  });
});
