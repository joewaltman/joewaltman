import { z } from "zod";
import { conditionSchema, factSchema, questionSchema, textItemSchema } from "../tariff/schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const ACTION_KINDS = ["notice", "records", "human", "vendor", "assessment", "stop"] as const;

export const obligationSchema = z.object({
  id: z.string().min(1),
  // Null for good practice that no law requires.
  law: z.string().nullable(),
  // dated: comply by the law's date. check: something to find out first. conditional: only if an
  // event happens (a layoff). practice: not a legal requirement.
  kind: z.enum(["dated", "check", "conditional", "practice"]),
  title: z.string().min(1),
  // The facts the obligation rests on. Visitors see it only when every one is confirmed.
  facts: z.array(z.string()),
  // Applies when any condition matches, unless any "unless" condition matches.
  whenAny: z.array(conditionSchema).min(1),
  unless: z.array(conditionSchema),
  summary: z.array(textItemSchema).min(1),
  actions: z.array(z.object({ kind: z.enum(ACTION_KINDS), text: textItemSchema })).min(1),
  // Shown when the obligation matched only because of a "not sure" answer.
  checkFirst: z.string().optional(),
  templates: z.array(z.string()),
});

export const templateSchema = z.object({
  title: z.string().min(1),
  fileName: z.string().regex(/^[a-z0-9-]+\.txt$/),
  facts: z.array(z.string()),
  body: z.array(z.string()),
});

// Notes on the hiring systems a visitor picks in the "ats" question: which built-in features score,
// rank or filter applicants, so the employer knows what to check is turned on.
export const vendorNotesSchema = z.object({
  // Why the features matter, shown once above the systems; a line with "when" only if the answers match.
  intro: z.array(z.object({ line: textItemSchema, when: conditionSchema.optional() })).min(1),
  // Shown when the visitor answered no to AI screening but picked a system with such features.
  answeredNo: z.string().min(1),
  // Keyed by the "ats" answer value.
  systems: z.record(z.string(), z.object({ name: z.string().min(1), lines: z.array(textItemSchema).min(1) })),
});

export const aiworkRulesSchema = z.object({
  version: z.string().min(1),
  asOf: isoDate,
  review: z.object({
    reviewedBy: z.string().nullable(),
    reviewedOn: isoDate.nullable(),
    // Set when Joe chose to open the checker without an attorney review; assumptions are footnoted instead.
    launchedWithoutReview: isoDate.nullable().optional(),
    note: z.string().optional(),
  }),
  facts: z.record(z.string(), factSchema),
  questions: z.array(questionSchema).min(1),
  laws: z.record(
    z.string(),
    z.object({
      name: z.string().min(1),
      effective: isoDate,
      facts: z.array(z.string()).min(1),
      // One plain line on what the law asks, for the landing page. It must say no more than the law's facts.
      short: z.string().min(1).optional(),
      // Who it applies to, with the facts that say so. Left out when no source states it.
      appliesTo: textItemSchema.optional(),
    }),
  ),
  obligations: z.array(obligationSchema).min(1),
  templates: z.record(z.string(), templateSchema),
  vendors: vendorNotesSchema,
});

export type AiworkRules = z.infer<typeof aiworkRulesSchema>;
export type Obligation = z.infer<typeof obligationSchema>;
export type AiworkTemplate = z.infer<typeof templateSchema>;
export type ActionKind = (typeof ACTION_KINDS)[number];

export function checkAiworkReferences(rules: AiworkRules): string[] {
  const problems: string[] = [];
  const facts = new Set(Object.keys(rules.facts));
  const questions = new Map(rules.questions.map((q) => [q.id, new Set(q.options?.map((o) => o.value) ?? [])]));
  const checkFacts = (where: string, ids: string[]) => {
    for (const id of ids) if (!facts.has(id)) problems.push(`${where} cites unknown fact "${id}"`);
  };
  for (const [id, law] of Object.entries(rules.laws)) {
    checkFacts(`law ${id}`, law.facts);
    if (law.appliesTo && typeof law.appliesTo !== "string") checkFacts(`law ${id}`, law.appliesTo.facts);
  }
  for (const q of rules.questions) {
    for (const [other, values] of Object.entries(q.showWhen ?? {})) {
      const allowed = questions.get(other);
      if (!allowed) problems.push(`question ${q.id} is shown for unknown question "${other}"`);
      else for (const v of values) if (!allowed.has(v)) problems.push(`question ${q.id} is shown for unknown answer "${v}"`);
      const at = rules.questions.findIndex((x) => x.id === other);
      if (at > rules.questions.indexOf(q)) problems.push(`question ${q.id} depends on a later question "${other}"`);
    }
  }
  for (const o of rules.obligations) {
    if (o.law !== null && !rules.laws[o.law]) problems.push(`obligation ${o.id} names unknown law "${o.law}"`);
    if (o.kind !== "practice" && o.facts.length === 0) problems.push(`obligation ${o.id} rests on no facts`);
    checkFacts(`obligation ${o.id}`, o.facts);
    for (const item of [...o.summary, ...o.actions.map((a) => a.text)]) if (typeof item !== "string") checkFacts(`obligation ${o.id}`, item.facts);
    for (const cond of [...o.whenAny, ...o.unless]) {
      for (const [q, values] of Object.entries(cond)) {
        const allowed = questions.get(q);
        if (!allowed) problems.push(`obligation ${o.id} checks unknown question "${q}"`);
        else for (const v of values) if (!allowed.has(v)) problems.push(`obligation ${o.id} checks "${q}" for unknown answer "${v}"`);
      }
    }
    for (const t of o.templates) if (!rules.templates[t]) problems.push(`obligation ${o.id} offers unknown template "${t}"`);
  }
  for (const [id, t] of Object.entries(rules.templates)) checkFacts(`template ${id}`, t.facts);
  const systems = questions.get("ats");
  if (!systems) problems.push('vendor notes need the "ats" question');
  for (const { line, when } of rules.vendors.intro) {
    if (typeof line !== "string") checkFacts("vendor intro", line.facts);
    for (const [q, values] of Object.entries(when ?? {})) {
      const allowed = questions.get(q);
      if (!allowed) problems.push(`vendor intro checks unknown question "${q}"`);
      else for (const v of values) if (!allowed.has(v)) problems.push(`vendor intro checks "${q}" for unknown answer "${v}"`);
    }
  }
  for (const [id, v] of Object.entries(rules.vendors.systems)) {
    if (systems && !systems.has(id)) problems.push(`vendor notes name unknown system "${id}"`);
    for (const item of v.lines) if (typeof item !== "string") checkFacts(`vendor ${id}`, item.facts);
  }
  return problems;
}
