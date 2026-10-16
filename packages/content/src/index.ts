import rawTariffRules from "../../../content/tariff-rules.json";
import { checkReferences, type TariffRules, tariffRulesSchema } from "./tariff/schema";

export * from "./tariff/calculator";
export * from "./tariff/engine";
export * from "./tariff/hts";
export * from "./tariff/schema";
export * from "./tariff/validate";
export { answerLabel, brokerSummary, formatIsoDate } from "./tariff/broker-summary";

// Parsed and cross-checked once at import, so a bad edit to the JSON fails loudly at build time.
function load(): TariffRules {
  const rules = tariffRulesSchema.parse(rawTariffRules);
  const problems = checkReferences(rules);
  if (problems.length > 0) throw new Error(`content/tariff-rules.json:\n${problems.join("\n")}`);
  return rules;
}

export const tariffRules: TariffRules = load();
