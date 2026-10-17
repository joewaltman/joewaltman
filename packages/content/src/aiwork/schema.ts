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
  laws: z.record(z.string(), z.object({ name: z.string().min(1), effective: isoDate, facts: z.array(z.string()).min(1) })),
  obligations: z.array(obligationSchema).min(1),
  templates: z.record(z.string(), templateSchema),
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
  for (const [id, law] of Object.entries(rules.laws)) checkFacts(`law ${id}`, law.facts);
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
  return problems;
}
