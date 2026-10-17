import { type Answers, type Assumption, AssumptionNotes, type ResolvedText, matches } from "../tariff/engine";
import type { Fact, TextItem } from "../tariff/schema";
import type { ActionKind, AiworkRules, Obligation } from "./schema";

export type AiworkAudience = "public" | "admin";

export interface AiworkObligation {
  id: string;
  kind: Obligation["kind"];
  law: { id: string; name: string; effective: string } | null;
  title: string;
  // Footnotes for assumptions behind the obligation that no line below cites.
  notes: number[];
  // True when it matched only through a "not sure" answer.
  uncertain: boolean;
  checkFirst: string | null;
  summary: ResolvedText[];
  actions: Array<{ kind: ActionKind; text: ResolvedText }>;
  templates: Array<{ id: string; title: string }>;
  // Facts behind it still awaiting attorney confirmation (admin view only).
  unverified: string[];
}

export interface AiworkResult {
  rulesVersion: string;
  asOf: string;
  reviewedBy: string | null;
  reviewedOn: string | null;
  launchedWithoutReview: string | null;
  obligations: AiworkObligation[];
  // Judgment calls the result relies on, numbered in the order a reader meets them.
  assumptions: Assumption[];
  // Laws checked that nothing in the answers triggered.
  notTriggered: Array<{ id: string; name: string }>;
  sources: Array<{ id: string } & Fact>;
  // Obligations held back from visitors because they rest on unconfirmed facts.
  hidden: string[];
}

const NOT_SURE = "not-sure";

function withoutNotSure(answers: Answers): Answers {
  const out: Answers = {};
  for (const [k, v] of Object.entries(answers)) out[k] = Array.isArray(v) ? v.filter((x) => x !== NOT_SURE) : v === NOT_SURE ? undefined : v;
  return out;
}

const KIND_ORDER: Record<Obligation["kind"], number> = { check: 0, dated: 1, conditional: 2, practice: 3 };

export function evaluateAiwork(answers: Answers, rules: AiworkRules, audience: AiworkAudience = "public"): AiworkResult {
  const sure = withoutNotSure(answers);
  const cited = new Set<string>();
  const hidden: string[] = [];
  const notes = new AssumptionNotes(rules);
  const resolve = (item: TextItem): ResolvedText => {
    const text = typeof item === "string" ? item : item.text;
    const facts = typeof item === "string" ? [] : item.facts;
    for (const f of facts) cited.add(f);
    return { text, facts, notes: notes.cite(facts) };
  };
  const itemFacts = (o: Obligation) =>
    new Set([...o.summary, ...o.actions.map((a) => a.text)].flatMap((i) => (typeof i === "string" ? [] : i.facts)));

  const obligations: AiworkObligation[] = [];
  for (const o of rules.obligations) {
    if (!o.whenAny.some((c) => matches(c, answers))) continue;
    if (o.unless.some((c) => matches(c, answers))) continue;
    const unverified = o.facts.filter((f) => rules.facts[f]?.verify);
    if (unverified.length > 0 && audience === "public") {
      hidden.push(o.id);
      continue;
    }
    for (const f of o.facts) cited.add(f);
    const law = o.law ? rules.laws[o.law]! : null;
    const uncertain = !o.whenAny.some((c) => matches(c, sure));
    // Cited first so footnote numbers follow reading order: the title, then the lines under it.
    const inLines = itemFacts(o);
    const titleNotes = notes.cite(o.facts.filter((f) => !inLines.has(f)));
    obligations.push({
      id: o.id,
      kind: o.kind,
      law: law && o.law ? { id: o.law, name: law.name, effective: law.effective } : null,
      title: o.title,
      notes: titleNotes,
      uncertain,
      checkFirst: uncertain ? (o.checkFirst ?? null) : null,
      summary: o.summary.map(resolve),
      actions: o.actions.map((a) => ({ kind: a.kind, text: resolve(a.text) })),
      templates: o.templates.map((id) => ({ id, title: rules.templates[id]!.title })),
      unverified: audience === "admin" ? unverified : [],
    });
  }
  obligations.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.law?.effective ?? "9999").localeCompare(b.law?.effective ?? "9999"));

  const triggered = new Set(obligations.map((o) => o.law?.id).filter(Boolean));
  const hiddenLaws = new Set(rules.obligations.filter((o) => hidden.includes(o.id)).map((o) => o.law));
  return {
    rulesVersion: rules.version,
    asOf: rules.asOf,
    reviewedBy: rules.review.reviewedBy,
    reviewedOn: rules.review.reviewedOn,
    launchedWithoutReview: rules.review.launchedWithoutReview ?? null,
    obligations,
    assumptions: notes.list,
    notTriggered: Object.entries(rules.laws)
      .filter(([id]) => !triggered.has(id) && !hiddenLaws.has(id))
      .map(([id, l]) => ({ id, name: l.name })),
    sources: [...cited].map((id) => ({ id, ...rules.facts[id]! })).filter((f) => audience === "admin" || !f.verify),
    hidden,
  };
}

// Groups for display and email: "In effect now", "By January 1, 2027", and so on.
export function obligationGroups(result: AiworkResult, today: string): Array<{ heading: string; items: AiworkObligation[] }> {
  const groups = new Map<string, AiworkObligation[]>();
  const label = (o: AiworkObligation) => {
    if (o.kind === "check") return "Check first";
    if (o.kind === "conditional") return "If it happens";
    if (o.kind === "practice") return "Good practice";
    const d = o.law!.effective;
    return d <= today ? `In effect now (since ${formatLongDate(d)})` : `By ${formatLongDate(d)}`;
  };
  for (const o of result.obligations) groups.set(label(o), [...(groups.get(label(o)) ?? []), o]);
  return [...groups].map(([heading, items]) => ({ heading, items }));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// A template as a plain-text file, or null when it is not available to this audience.
export function templateText(rules: AiworkRules, id: string, audience: AiworkAudience): { fileName: string; text: string } | null {
  const t = rules.templates[id];
  if (!t) return null;
  if (audience === "public" && t.facts.some((f) => rules.facts[f]?.verify)) return null;
  const reviewed = rules.review.reviewedBy ? `Rules reviewed by ${rules.review.reviewedBy}.` : "Not reviewed by an attorney.";
  return {
    fileName: t.fileName,
    text: `${t.title}\n\n${t.body.join("\n")}\n\nFrom the California AI-at-Work Checker at joewaltman.com/aiwork, rules as of ${formatLongDate(rules.asOf)}. Information, not legal advice. ${reviewed} Adapt this draft to your situation before using it.\n`,
  };
}
