import type { Rate, TariffRules } from "./schema";

export interface CalcInput {
  categoryId: string;
  countryId: string;
  // Only matters for USMCA countries.
  usmcaQualified: boolean;
  // Declared value of one shipment, in dollars.
  declaredValue: number;
  shipmentsPerMonth: number;
  // MFN base rate from the HTS lookup, as a percent. Null when no HTS code was given or it has no simple percent rate.
  baseRatePct: number | null;
  brokerFeePerEntry: number | null;
}

export interface Range {
  low: number;
  high: number;
}

export interface Layer {
  id: "base" | "s301" | "s232";
  label: string;
  // Null when there is no rate on file for this layer; it is then left out of the totals.
  rate: Range | null;
  reason: string;
  facts: string[];
}

export interface Scenario {
  label: string;
  layers: Layer[];
  totalRate: Range;
  dutyPerShipment: Range;
  dutyPerMonth: Range;
  includesBaseRate: boolean;
}

export interface CalcResult {
  today: Scenario;
  future: Scenario;
  fees: {
    mpfMinimumPerEntry: number;
    brokerFeePerEntry: number | null;
    perShipment: number;
    perMonth: number;
    facts: string[];
  };
}

const toRange = (r: Rate): Range => ("pct" in r ? { low: r.pct, high: r.pct } : { low: r.low, high: r.high });
const point = (n: number): Range => ({ low: n, high: n });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeLandedCost(input: CalcInput, rules: TariffRules): CalcResult {
  const c = rules.calculator;
  const category = c.categories.find((x) => x.id === input.categoryId);
  const country = c.countries.find((x) => x.id === input.countryId);
  if (!category) throw new Error(`Unknown category "${input.categoryId}"`);
  if (!country) throw new Error(`Unknown country "${input.countryId}"`);

  const scenario = (label: string, s232: Rate | null): Scenario => {
    const layers: Layer[] = [];

    layers.push({
      id: "base",
      label: "Base duty (MFN)",
      rate: input.baseRatePct === null ? null : point(input.baseRatePct),
      reason:
        input.baseRatePct === null
          ? "Enter an HTS code to include the base rate."
          : "From the USITC Harmonized Tariff Schedule for the HTS code you entered.",
      facts: [],
    });

    const s301Label = "Section 301 forced-labor tariff";
    const exemptionsConfirmed = rules.facts[c.s301.exemptionsFact]?.verify === false;
    const netConfirmed = rules.facts[c.s301.netOfMfnFact]?.verify === false;
    const countryRate: Range =
      country.s301Pct === null
        ? { low: c.s301.unlistedLowPct, high: c.s301.unlistedHighPct }
        : point(country.s301Pct);
    const countryReason =
      country.s301Pct === null
        ? `The rate for goods from this country is not confirmed here. It is either ${c.s301.unlistedLowPct}% or ${c.s301.unlistedHighPct}%; ask your broker which.`
        : `${country.s301Pct}% for goods from ${country.label}.`;
    const countryFacts = [...c.s301.facts, ...country.facts];

    let s301: Layer;
    if (s232) {
      s301 = exemptionsConfirmed
        ? { id: "s301", label: s301Label, rate: point(0), reason: "Not charged on goods already under Section 232.", facts: [...c.s301.facts, c.s301.exemptionsFact] }
        : {
            id: "s301",
            label: s301Label,
            rate: { low: 0, high: countryRate.high },
            reason: "It is not confirmed here whether this applies on top of Section 232, so the range shows both. Ask your broker.",
            facts: countryFacts,
          };
    } else if (country.usmca && input.usmcaQualified) {
      s301 = exemptionsConfirmed
        ? { id: "s301", label: s301Label, rate: point(0), reason: "Not charged on USMCA-qualifying goods.", facts: [...c.s301.facts, c.s301.exemptionsFact] }
        : {
            id: "s301",
            label: s301Label,
            rate: { low: 0, high: countryRate.high },
            reason: "It is not confirmed here whether USMCA-qualifying goods are exempt, so the range shows both. Ask your broker.",
            facts: countryFacts,
          };
    } else if (country.netOfMfn && input.baseRatePct !== null && country.s301Pct !== null) {
      const net = round2(Math.max(0, country.s301Pct - input.baseRatePct));
      s301 = netConfirmed
        ? { id: "s301", label: s301Label, rate: point(net), reason: `${country.s301Pct}% for goods from ${country.label}, including the base duty.`, facts: [...countryFacts, c.s301.netOfMfnFact] }
        : {
            id: "s301",
            label: s301Label,
            rate: { low: net, high: country.s301Pct },
            reason: `${countryReason} It is not confirmed here whether that includes the base duty, so the range shows both.`,
            facts: countryFacts,
          };
    } else {
      s301 = { id: "s301", label: s301Label, rate: countryRate, reason: countryReason, facts: countryFacts };
    }
    layers.push(s301);

    layers.push({
      id: "s232",
      label: "Section 232 tariff",
      rate: s232 ? toRange(s232) : null,
      reason: s232 ? `Applies to ${category.label.toLowerCase()}.` : "No Section 232 rate on file for this category.",
      facts: category.facts,
    });

    const counted = layers.filter((l) => l.rate !== null);
    const totalRate = {
      low: round2(counted.reduce((sum, l) => sum + l.rate!.low, 0)),
      high: round2(counted.reduce((sum, l) => sum + l.rate!.high, 0)),
    };
    const dutyPerShipment = {
      low: round2((input.declaredValue * totalRate.low) / 100),
      high: round2((input.declaredValue * totalRate.high) / 100),
    };
    return {
      label,
      layers,
      totalRate,
      dutyPerShipment,
      dutyPerMonth: {
        low: round2(dutyPerShipment.low * input.shipmentsPerMonth),
        high: round2(dutyPerShipment.high * input.shipmentsPerMonth),
      },
      includesBaseRate: input.baseRatePct !== null,
    };
  };

  const perShipment = round2(c.mpfMinimum.amount + (input.brokerFeePerEntry ?? 0));
  return {
    today: scenario("Today", category.s232Today),
    future: scenario(c.futureLabel, category.s232Future),
    fees: {
      mpfMinimumPerEntry: c.mpfMinimum.amount,
      brokerFeePerEntry: input.brokerFeePerEntry,
      perShipment,
      perMonth: round2(perShipment * input.shipmentsPerMonth),
      facts: [...c.mpfMinimum.facts, ...c.deMinimis.facts],
    },
  };
}

// Turns USITC rate text into a percent when it is a plain ad valorem rate ("Free", "4.5%").
// Compound or specific rates ("4.4¢/kg + 2%") return null so the page can say so instead of guessing.
export function parseAdValorem(rateText: string): number | null {
  const t = rateText.trim();
  if (/^free$/i.test(t)) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*%$/);
  return m ? Number(m[1]) : null;
}
