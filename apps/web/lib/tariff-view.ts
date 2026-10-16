import type { Fact, TariffRules, TextItem } from "@jw/content";

export { formatIsoDate as formatDate } from "@jw/content";

// Copy that cites an unverified fact never reaches the public pages.
export function publicTexts(items: TextItem[], rules: TariffRules): string[] {
  return items
    .filter((i) => typeof i === "string" || i.facts.every((f) => rules.facts[f]?.verify === false))
    .map((i) => (typeof i === "string" ? i : i.text));
}

export function publicSources(ids: string[], rules: TariffRules): Array<{ id: string } & Fact> {
  return [...new Set(ids)]
    .map((id) => ({ id, ...rules.facts[id]! }))
    .filter((f) => f.text && !f.verify);
}

export function isVerified(rules: TariffRules, factIds: string[]): boolean {
  return factIds.every((f) => rules.facts[f]?.verify === false);
}

export function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
