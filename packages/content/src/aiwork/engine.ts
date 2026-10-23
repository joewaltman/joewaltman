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
  // Links to the sources of every fact it rests on. Missing on results saved before October 23, 2026.
  sources?: string[];
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
  // Notes on the hiring systems the visitor picked. Missing on results saved before October 21, 2026.
  vendors?: VendorNotes | null;
}

export interface VendorNotes {
  intro: ResolvedText[];
  // Set when the visitor answered no to AI screening.
  answeredNo: string | null;
  systems: Array<{ id: string; name: string; lines: ResolvedText[] }>;
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
    const allFacts = [...new Set([...o.facts, ...itemFacts(o)])];
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
      sources: sourcesOf(rules, allFacts, audience),
    });
  }
  obligations.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.law?.effective ?? "9999").localeCompare(b.law?.effective ?? "9999"));

  // After the obligations, so footnote numbers keep reading order.
  const vendors = vendorNotes(answers, rules, audience, resolve);

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
    vendors,
  };
}

function vendorNotes(answers: Answers, rules: AiworkRules, audience: AiworkAudience, resolve: (item: TextItem) => ResolvedText): VendorNotes | null {
  const raw = answers.ats;
  const picked = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).filter((id) => rules.vendors.systems[id]);
  // Lines resting on a fact still marked verify stay out of what visitors see.
  const shown = (item: TextItem) => audience === "admin" || typeof item === "string" || item.facts.every((f) => !rules.facts[f]?.verify);
  const systems = picked
    .map((id) => {
      const v = rules.vendors.systems[id]!;
      return { id, name: v.name, items: v.lines.filter(shown) };
    })
    .filter((v) => v.items.length > 0);
  if (systems.length === 0) return null;
  return {
    intro: rules.vendors.intro
      .filter(({ line, when }) => (!when || matches(when, answers)) && shown(line))
      .map(({ line }) => resolve(line)),
    answeredNo: answers.aiScreening === "no" ? rules.vendors.answeredNo : null,
    systems: systems.map((v) => ({ id: v.id, name: v.name, lines: v.items.map(resolve) })),
  };
}

// The source links behind a set of facts, once each, leaving out facts still marked verify for visitors.
function sourcesOf(rules: AiworkRules, factIds: string[], audience: AiworkAudience): string[] {
  const out: string[] = [];
  for (const id of factIds) {
    const f = rules.facts[id];
    if (!f || (f.verify && audience !== "admin")) continue;
    for (const u of f.sources) if (!out.includes(u)) out.push(u);
  }
  return out;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export interface TimelineLaw {
  id: string;
  name: string;
  short: string | null;
  // The law's start date, shown when the "in force now" group spans more than one date.
  since: string | null;
  appliesTo: ResolvedText | null;
  sources: string[];
}

// Every law by the date it starts: one "In force now" group, then one group per future date. Built
// from the rules file, so a law moves into "In force now" on its date without any change here.
export function lawTimeline(rules: AiworkRules, today: string, audience: AiworkAudience = "public"): { groups: Array<{ heading: string; date: string; inForce: boolean; laws: TimelineLaw[] }>; assumptions: Assumption[] } {
  const notes = new AssumptionNotes(rules);
  const entries = Object.entries(rules.laws).sort(([, a], [, b]) => a.effective.localeCompare(b.effective));
  const inForce = entries.filter(([, l]) => l.effective <= today);
  const oneDate = new Set(inForce.map(([, l]) => l.effective)).size === 1;
  const item = ([id, l]: (typeof entries)[number], showSince: boolean): TimelineLaw => {
    const scope = l.appliesTo ?? null;
    const scopeFacts = scope && typeof scope !== "string" ? scope.facts : [];
    const hidden = scopeFacts.some((f) => rules.facts[f]?.verify) && audience !== "admin";
    return {
      id,
      name: l.name,
      short: l.short ?? null,
      since: showSince ? l.effective : null,
      appliesTo: scope && !hidden ? { text: typeof scope === "string" ? scope : scope.text, facts: scopeFacts, notes: notes.cite(scopeFacts) } : null,
      sources: sourcesOf(rules, [...l.facts, ...(hidden ? [] : scopeFacts)], audience),
    };
  };
  const groups: Array<{ heading: string; date: string; inForce: boolean; laws: TimelineLaw[] }> = [];
  if (inForce.length > 0) {
    const first = inForce[0]![1].effective;
    groups.push({
      heading: oneDate ? `In force now (since ${formatLongDate(first)})` : "In force now",
      date: first,
      inForce: true,
      laws: inForce.map((e) => item(e, !oneDate)),
    });
  }
  for (const date of [...new Set(entries.filter(([, l]) => l.effective > today).map(([, l]) => l.effective))]) {
    groups.push({ heading: formatLongDate(date), date, inForce: false, laws: entries.filter(([, l]) => l.effective === date).map((e) => item(e, false)) });
  }
  return { groups, assumptions: notes.list };
}

// "Ten questions (eleven if you have 75 or more employees)", counted from the form. The email box
// is not counted.
export function questionCountText(rules: AiworkRules): string {
  const asked = rules.questions.filter((q) => q.type !== "email");
  const always = asked.filter((q) => !q.showWhen).length;
  const extras = new Map<string, number>();
  for (const q of asked) if (q.showWhen) extras.set(q.showWhenNote ?? "for some answers", (extras.get(q.showWhenNote ?? "for some answers") ?? 0) + 1);
  const more = [...extras].map(([note, n]) => `${word(always + n)} ${note}`);
  return `${capital(word(always))} questions${more.length > 0 ? ` (${more.join("; ")})` : ""}`;
}

// The next date on which one or more of the laws take effect, for the landing page headline:
// "Four California rules on AI at work start January 1, 2027". Null once every law is in effect.
export function upcomingLaws(rules: AiworkRules, today: string): { date: string; headline: string; laws: Array<{ id: string; name: string; short: string | null }> } | null {
  const future = Object.entries(rules.laws).filter(([, l]) => l.effective > today);
  if (future.length === 0) return null;
  const date = future.map(([, l]) => l.effective).sort()[0]!;
  const laws = future.filter(([, l]) => l.effective === date).map(([id, l]) => ({ id, name: l.name, short: l.short ?? null }));
  const n = laws.length;
  const headline = `${capital(word(n))} California ${n === 1 ? "rule" : "rules"} on AI at work ${n === 1 ? "starts" : "start"} ${formatLongDate(date)}`;
  return { date, headline, laws };
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
