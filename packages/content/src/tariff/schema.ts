import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// A sourced statement. Facts marked verify are shown in admin only, and any copy that cites
// one is held back from users until Joe's broker or attorney confirms it.
export const factSchema = z
  .object({
    text: z.string().min(1),
    sources: z.array(z.url()),
    asOf: isoDate,
    verify: z.boolean(),
    // Set when the tool relies on a judgment call rather than a confirmed fact. Pages show this
    // text as a numbered footnote wherever copy cites the fact.
    assumption: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((f) => f.verify || f.sources.length > 0, {
    message: "A fact without a source must be marked verify",
  });

// Plain copy, or copy that cites facts by id.
export const textItemSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), facts: z.array(z.string()).min(1) }),
]);

const optionSchema = z.object({ value: z.string().min(1), label: z.string().min(1) });

// Every key must match: the answer (or one of the answers, for multi questions) is in the list.
export const conditionSchema = z.record(z.string(), z.array(z.string()).min(1));

export const questionSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  label: z.string().min(1),
  help: z.string().optional(),
  type: z.enum(["single", "multi", "text", "email"]),
  required: z.boolean(),
  options: z.array(optionSchema).optional(),
  // Asked only when earlier answers match, for example a question for larger employers. The form
  // hides it otherwise, and the answer is ignored.
  showWhen: conditionSchema.optional(),
  // Who sees it, for the question count on the landing page: "if you have 75 or more employees".
  showWhenNote: z.string().min(1).optional(),
  // Shown under the question in a collapsed "How do I tell?" box.
  explainer: z
    .object({ summary: z.string().min(1), body: z.array(textItemSchema).min(1) })
    .optional(),
});

export const pathSchema = z.object({
  title: z.string().min(1),
  kind: z.enum(["refund", "next-step", "no-path"]),
  summary: z.array(textItemSchema).min(1),
  steps: z.array(textItemSchema),
  documents: z.array(textItemSchema),
  deadlines: z.array(textItemSchema),
});

export const actionSchema = z.object({
  id: z.string().min(1),
  when: conditionSchema,
  onlyForPaths: z.array(z.string()).optional(),
  title: z.string().min(1),
  body: z.array(textItemSchema).min(1),
});

const rateSchema = z.union([
  z.object({ pct: z.number().min(0).max(1000) }),
  z.object({ low: z.number().min(0), high: z.number().min(0) }),
]);

export const categorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Section 232 rate today and on the future date. Null means no Section 232 rate on file.
  s232Today: rateSchema.nullable(),
  s232Future: rateSchema.nullable(),
  facts: z.array(z.string()),
  notes: z.array(textItemSchema).default([]),
});

export const countrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Section 301 forced-labor rate. Null means the rate for this country is not confirmed.
  s301Pct: z.number().nullable(),
  usmca: z.boolean(),
  // The source says this country's rate is net of the MFN base duty (unconfirmed until its fact is verified).
  netOfMfn: z.boolean().default(false),
  facts: z.array(z.string()),
  notes: z.array(textItemSchema).default([]),
});

export const calculatorSchema = z.object({
  futureDate: isoDate,
  futureLabel: z.string().min(1),
  categories: z.array(categorySchema).min(1),
  countries: z.array(countrySchema).min(1),
  s301: z.object({
    unlistedLowPct: z.number(),
    unlistedHighPct: z.number(),
    facts: z.array(z.string()).min(1),
    // Until these facts are verified, the calculator shows a range instead of applying the rule.
    exemptionsFact: z.string(),
    netOfMfnFact: z.string(),
    note: z.array(textItemSchema),
  }),
  mpfMinimum: z.object({ amount: z.number().positive(), facts: z.array(z.string()).min(1) }),
  brokerFee: z.object({ low: z.number(), high: z.number(), facts: z.array(z.string()).min(1) }),
  deMinimis: z.object({ facts: z.array(z.string()).min(1), note: z.array(textItemSchema) }),
});

export const tariffRulesSchema = z.object({
  version: z.string().min(1),
  asOf: isoDate,
  facts: z.record(z.string(), factSchema),
  questions: z.array(questionSchema).min(1),
  rules: z.array(z.object({ id: z.string().min(1), when: conditionSchema, path: z.string().min(1) })),
  fallbackPath: z.string().min(1),
  paths: z.record(z.string(), pathSchema),
  actions: z.array(actionSchema),
  calculator: calculatorSchema,
});

export type Fact = z.infer<typeof factSchema>;
export type TextItem = z.infer<typeof textItemSchema>;
export type Question = z.infer<typeof questionSchema>;
export type TariffPath = z.infer<typeof pathSchema>;
export type TariffAction = z.infer<typeof actionSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Country = z.infer<typeof countrySchema>;
export type Rate = z.infer<typeof rateSchema>;
export type TariffRules = z.infer<typeof tariffRulesSchema>;

// Cross-references the schema cannot express: every fact id, path id and question id must exist.
export function checkReferences(rules: TariffRules): string[] {
  const problems: string[] = [];
  const factIds = new Set(Object.keys(rules.facts));
  const pathIds = new Set(Object.keys(rules.paths));

  const checkItems = (where: string, items: TextItem[]) => {
    for (const item of items) {
      if (typeof item === "string") continue;
      for (const f of item.facts) if (!factIds.has(f)) problems.push(`${where}: unknown fact "${f}"`);
    }
  };
  const checkWhen = (where: string, when: Record<string, string[]>) => {
    for (const [qid, values] of Object.entries(when)) {
      const q = rules.questions.find((x) => x.id === qid);
      if (!q) {
        problems.push(`${where}: unknown question "${qid}"`);
        continue;
      }
      const allowed = new Set(q.options?.map((o) => o.value) ?? []);
      for (const v of values) if (!allowed.has(v)) problems.push(`${where}: "${qid}" has no option "${v}"`);
    }
  };

  for (const q of rules.questions) if (q.explainer) checkItems(`question ${q.id}`, q.explainer.body);
  for (const r of rules.rules) {
    if (!pathIds.has(r.path)) problems.push(`rule ${r.id}: unknown path "${r.path}"`);
    checkWhen(`rule ${r.id}`, r.when);
  }
  if (!pathIds.has(rules.fallbackPath)) problems.push(`fallbackPath: unknown path "${rules.fallbackPath}"`);
  for (const [id, p] of Object.entries(rules.paths)) {
    checkItems(`path ${id}`, [...p.summary, ...p.steps, ...p.documents, ...p.deadlines]);
  }
  for (const a of rules.actions) {
    checkWhen(`action ${a.id}`, a.when);
    checkItems(`action ${a.id}`, a.body);
    for (const p of a.onlyForPaths ?? []) if (!pathIds.has(p)) problems.push(`action ${a.id}: unknown path "${p}"`);
  }
  const c = rules.calculator;
  const calcFacts = [
    ...c.categories.flatMap((x) => x.facts),
    ...c.countries.flatMap((x) => x.facts),
    ...c.s301.facts,
    ...c.mpfMinimum.facts,
    ...c.brokerFee.facts,
    ...c.deMinimis.facts,
    c.s301.exemptionsFact,
    c.s301.netOfMfnFact,
  ];
  for (const f of calcFacts) if (!factIds.has(f)) problems.push(`calculator: unknown fact "${f}"`);
  checkItems("calculator s301 note", c.s301.note);
  checkItems("calculator de minimis note", c.deMinimis.note);
  for (const cat of c.categories) checkItems(`category ${cat.id}`, cat.notes);
  for (const country of c.countries) checkItems(`country ${country.id}`, country.notes);
  return problems;
}
