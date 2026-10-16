import type { Answers, TariffResult } from "./engine";
import type { TariffRules } from "./schema";

export function answerLabel(rules: TariffRules, questionId: string, value: string | string[] | undefined): string {
  const q = rules.questions.find((x) => x.id === questionId);
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return "No answer";
  const values = Array.isArray(value) ? value : [value];
  if (!q?.options) return values.join(", ");
  return values.map((v) => q.options!.find((o) => o.value === v)?.label ?? v).join("; ");
}

// Plain text the importer can paste into an email to their customs broker.
export function brokerSummary(input: {
  answers: Answers;
  result: TariffResult;
  rules: TariffRules;
  preparedOn: string;
}): string {
  const { answers, result, rules } = input;
  const lines: string[] = [
    "IEEPA tariff refund: summary for my customs broker",
    "",
    `Prepared with the free Tariff Refund Tool at joewaltman.com/tariffrefund on ${input.preparedOn}. Rules as of ${result.asOf}.`,
    "",
    "What I told the tool:",
  ];
  for (const q of rules.questions) {
    if (q.type === "email") continue;
    lines.push(`- ${q.label} ${answerLabel(rules, q.id, answers[q.id])}`);
  }
  lines.push("", `Where it points: ${result.path.title}`);
  for (const s of result.path.summary) lines.push(s.text);
  const section = (title: string, items: Array<{ text: string }>) => {
    if (items.length === 0) return;
    lines.push("", title);
    for (const i of items) lines.push(`- ${i.text}`);
  };
  section("Next steps:", result.path.steps);
  for (const a of result.actions) section(`${a.title}:`, a.body);
  section("Documents to gather:", result.path.documents);
  section("Deadlines:", result.path.deadlines);
  lines.push("", "Can you confirm this applies to my entries and tell me what you need from me?");
  return lines.join("\n");
}
