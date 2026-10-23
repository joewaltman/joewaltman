import { type Answers, matches } from "./engine";
import type { Question } from "./schema";

export interface ValidationResult {
  answers: Answers;
  errors: Record<string, string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reads a submitted form (any object with getAll) against the questions in the rules file.
export function readAnswers(
  rules: { questions: Question[] },
  form: { getAll(name: string): unknown[] },
): ValidationResult {
  const answers: Answers = {};
  const errors: Record<string, string> = {};

  for (const q of rules.questions) {
    // A question shown only for some earlier answers is skipped, and not required, for everyone else.
    if (q.showWhen && !matches(q.showWhen, answers)) continue;
    const raw = form
      .getAll(q.id)
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
    const allowed = new Set(q.options?.map((o) => o.value) ?? []);

    if (q.type === "multi") {
      const values = raw.filter((v) => allowed.has(v));
      if (values.length !== raw.length) errors[q.id] = "Pick from the listed options.";
      if (q.required && values.length === 0) errors[q.id] = "Pick at least one.";
      answers[q.id] = values;
      continue;
    }

    const value = raw[0];
    if (value === undefined) {
      if (q.required) errors[q.id] = "This one is required.";
      continue;
    }
    if (q.type === "single" && !allowed.has(value)) {
      errors[q.id] = "Pick one of the listed options.";
      continue;
    }
    if (q.type === "email" && (!EMAIL.test(value) || value.length > 254)) {
      errors[q.id] = "That email address does not look right.";
      continue;
    }
    answers[q.id] = q.type === "text" ? value.slice(0, 500) : value;
  }

  return { answers, errors };
}
