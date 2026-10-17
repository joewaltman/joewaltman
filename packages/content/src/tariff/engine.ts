import type { Fact, TariffPath, TariffRules, TextItem } from "./schema";

export type Answers = Record<string, string | string[] | undefined>;

// "public" hides any copy that cites an unverified fact. "admin" shows everything and says what was hidden.
export type Audience = "public" | "admin";

export interface ResolvedText {
  text: string;
  facts: string[];
  // Footnote numbers (1-based) for the assumptions this text relies on.
  notes: number[];
}

export interface Assumption {
  id: string;
  text: string;
}

// Numbers assumptions in the order they are first cited, so footnote 1 is the first one a reader meets.
export class AssumptionNotes {
  readonly list: Assumption[] = [];
  constructor(private readonly rules: { facts: Record<string, Fact> }) {}
  cite(factIds: string[]): number[] {
    const out: number[] = [];
    for (const id of factIds) {
      const text = this.rules.facts[id]?.assumption;
      if (!text) continue;
      let i = this.list.findIndex((a) => a.id === id);
      if (i < 0) i = this.list.push({ id, text }) - 1;
      if (!out.includes(i + 1)) out.push(i + 1);
    }
    return out;
  }
}

export interface HiddenText {
  text: string;
  facts: string[];
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
  assumptions: Assumption[];
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
  const notes = new AssumptionNotes(rules);

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
      out.push({ text, facts, notes: notes.cite(facts) });
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
    assumptions: notes.list,
    hidden,
  };
}

export function unverifiedFacts(rules: TariffRules): Array<{ id: string } & Fact> {
  return Object.entries(rules.facts)
    .filter(([, f]) => f.verify)
    .map(([id, f]) => ({ id, ...f }));
}
