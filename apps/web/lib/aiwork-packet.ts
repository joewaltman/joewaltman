import { type AiworkRules, formatLongDate } from "@jw/content";

// Everything an attorney needs to review, as one plain-text document: the questions, each
// statement with its sources and status, each obligation with its triggers, and the templates.
export function reviewPacket(rules: AiworkRules): string {
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  const qLabel = new Map(rules.questions.map((q) => [q.id, q]));
  const answerText = (qid: string, values: string[]) => {
    const q = qLabel.get(qid);
    const labels = values.map((v) => q?.options?.find((o) => o.value === v)?.label ?? v);
    return `Q${q?.number ?? "?"} (${q?.label ?? qid}) is ${labels.join(" or ")}`;
  };

  line("California AI-at-Work Checker: the rules behind it");
  line(`Rules version ${rules.version}, as of ${formatLongDate(rules.asOf)}.`);
  line(
    rules.review.reviewedBy
      ? `Reviewed by ${rules.review.reviewedBy} on ${formatLongDate(rules.review.reviewedOn!)}.`
      : "Not reviewed by an attorney. Statements marked IN USE are shown to visitors; where one rests on a judgment call, the assumption is listed under it and shown to visitors as a footnote. Statements marked FOR REVIEW are held back from visitors.",
  );
  line();
  line("1. Questions visitors answer");
  for (const q of rules.questions) {
    line(`  ${q.number}. ${q.label}${q.options ? ` [${q.options.map((o) => o.label).join(" / ")}]` : ""}`);
  }
  line();
  line("2. Statements the tool relies on");
  for (const [id, f] of Object.entries(rules.facts)) {
    line(`  [${id}] ${f.verify ? "FOR REVIEW" : "IN USE"}: ${f.text}`);
    if (f.sources.length) line(`      Sources: ${f.sources.join(" ; ")}`);
    if (f.assumption) line(`      Assumption: ${f.assumption}`);
    if (f.note) line(`      Note: ${f.note}`);
  }
  line();
  line("3. Obligations and when they are shown");
  for (const o of rules.obligations) {
    const law = o.law ? rules.laws[o.law] : null;
    line(`  ${o.title}`);
    line(`      Law: ${law ? `${law.name}, effective ${formatLongDate(law.effective)}` : "none (good practice)"}`);
    line(`      Shown when: ${o.whenAny.map((c) => Object.entries(c).map(([q, v]) => answerText(q, v)).join(" and ")).join("; or ")}`);
    if (o.unless.length) line(`      Not shown when: ${o.unless.map((c) => Object.entries(c).map(([q, v]) => answerText(q, v)).join(" and ")).join("; or ")}`);
    for (const s of o.summary) line(`      Says: ${typeof s === "string" ? s : s.text}`);
    for (const a of o.actions) line(`      To do (${a.kind}): ${typeof a.text === "string" ? a.text : a.text.text}`);
    if (o.checkFirst) line(`      If answered "not sure": ${o.checkFirst}`);
    line(`      Rests on: ${o.facts.join(", ") || "nothing"}`);
  }
  line();
  line("4. Notice templates");
  for (const [id, t] of Object.entries(rules.templates)) {
    line(`  ${t.title} [${id}]`);
    for (const b of t.body) line(`      ${b}`);
    line();
  }
  return `${out.join("\n")}\n`;
}
