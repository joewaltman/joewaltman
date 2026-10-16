import type { Fact, TariffPath, TariffRules, TextItem } from "./schema";

export type Answers = Record<string, string | string[] | undefined>;

// "public" hides any copy that cites an unverified fact. "admin" shows everything and says what was hidden.
export type Audience = "public" | "admin";

export interface ResolvedText {
  text: string;
  facts: string[];
}

export interface HiddenText extends ResolvedText {
  where: string;
  verifyFacts: string[];
}

export interface TariffResult {
  rulesVersion: string;
  asOf: string;
  ruleId: string | null;
  pathId: string;
  path: {
    title: string;
    kind: TariffPath["kind"];
    summary: ResolvedText[];
    steps: ResolvedText[];
    documents: ResolvedText[];
    deadlines: ResolvedText[];
  };
  actions: Array<{ id: string; title: string; body: ResolvedText[] }>;
  sources: Array<{ id: string } & Fact>;
  hidden: HiddenText[];
}

export function matches(when: Record<string, string[]>, answers: Answers): boolean {
  return Object.entries(when).every(([key, allowed]) => {
    const value = answers[key];
    if (value === undefined) return false;
    const values = Array.isArray(value) ? value : [value];
    return values.some((v) => allowed.includes(v));
  });
}

export function evaluateTariff(
  answers: Answers,
  rules: TariffRules,
  audience: Audience = "public",
): TariffResult {
  const rule = rules.rules.find((r) => matches(r.when, answers)) ?? null;
  const pathId = rule?.path ?? rules.fallbackPath;
  const path = rules.paths[pathId];
  if (!path) throw new Error(`Rules reference missing path "${pathId}"`);

  const hidden: HiddenText[] = [];
  const cited = new Set<string>();

  const resolve = (where: string, items: TextItem[]): ResolvedText[] => {
    const out: ResolvedText[] = [];
    for (const item of items) {
      const text = typeof item === "string" ? item : item.text;
      const facts = typeof item === "string" ? [] : item.facts;
      const verifyFacts = facts.filter((f) => rules.facts[f]?.verify);
      if (verifyFacts.length > 0) {
        hidden.push({ where, text, facts, verifyFacts });
        if (audience === "public") continue;
      }
      for (const f of facts) cited.add(f);
      out.push({ text, facts });
    }
    return out;
  };

  const resolvedPath = {
    title: path.title,
    kind: path.kind,
    summary: resolve(`${pathId}.summary`, path.summary),
    steps: resolve(`${pathId}.steps`, path.steps),
    documents: resolve(`${pathId}.documents`, path.documents),
    deadlines: resolve(`${pathId}.deadlines`, path.deadlines),
  };

  const actions = rules.actions
    .filter((a) => matches(a.when, answers))
    .filter((a) => !a.onlyForPaths || a.onlyForPaths.includes(pathId))
    .map((a) => ({ id: a.id, title: a.title, body: resolve(`action ${a.id}`, a.body) }))
    .filter((a) => a.body.length > 0);

  const sources = [...cited]
    .map((id) => ({ id, ...rules.facts[id]! }))
    .filter((f) => audience === "admin" || !f.verify);

  return {
    rulesVersion: rules.version,
    asOf: rules.asOf,
    ruleId: rule?.id ?? null,
    pathId,
    path: resolvedPath,
    actions,
    sources,
    hidden,
  };
}

export function unverifiedFacts(rules: TariffRules): Array<{ id: string } & Fact> {
  return Object.entries(rules.facts)
    .filter(([, f]) => f.verify)
    .map(([id, f]) => ({ id, ...f }));
}
