import { describe, expect, it } from "vitest";
import { tariffRules } from "../index";
import { type CalcInput, computeLandedCost, parseAdValorem } from "./calculator";

const input = (changes: Partial<CalcInput>): CalcInput => ({
  categoryId: "general",
  countryId: "china",
  usmcaQualified: false,
  declaredValue: 10000,
  shipmentsPerMonth: 1,
  baseRatePct: null,
  brokerFeePerEntry: null,
  ...changes,
});

// Worked by hand from the rules file. The Section 301 exemptions and the net-of-base-duty rule
// are applied as assumptions (footnoted on the page).
describe("hand-computed examples", () => {
  it("A. kitchen cabinets from Vietnam, HTS 9403.40.90 (Free), $20,000 x 2 a month, $50 broker fee", () => {
    const r = computeLandedCost(
      input({ categoryId: "kitchen_cabinets", countryId: "vietnam", declaredValue: 20000, shipmentsPerMonth: 2, baseRatePct: 0, brokerFeePerEntry: 50 }),
      tariffRules,
    );
    // Today: 0% base + 25% Section 232; Section 301 not charged on Section 232 goods. Total 25%.
    expect(r.today.totalRate).toEqual({ low: 25, high: 25 });
    expect(r.today.dutyPerShipment).toEqual({ low: 5000, high: 5000 });
    expect(r.today.dutyPerMonth).toEqual({ low: 10000, high: 10000 });
    // January 1, 2027: Section 232 goes to 50%.
    expect(r.future.totalRate).toEqual({ low: 50, high: 50 });
    expect(r.future.dutyPerShipment).toEqual({ low: 10000, high: 10000 });
    expect(r.future.dutyPerMonth).toEqual({ low: 20000, high: 20000 });
    // $26.79 minimum processing fee + $50 broker fee = $76.79 a shipment, $153.58 a month.
    expect(r.fees.brokerFeeIsEstimate).toBe(false);
    expect(r.fees.perShipment).toEqual({ low: 76.79, high: 76.79 });
    expect(r.fees.perMonth).toEqual({ low: 153.58, high: 153.58 });
  });

  it("B. auto parts from Mexico, USMCA-qualifying, HTS 8708.29.51 (2.5%), $10,000 x 4 a month, no broker fee given", () => {
    const r = computeLandedCost(
      input({ categoryId: "auto_parts", countryId: "mexico", usmcaQualified: true, shipmentsPerMonth: 4, baseRatePct: 2.5 }),
      tariffRules,
    );
    // 2.5% base + 25% Section 232 + 0% Section 301 = 27.5%.
    expect(r.today.totalRate).toEqual({ low: 27.5, high: 27.5 });
    expect(r.today.dutyPerShipment).toEqual({ low: 2750, high: 2750 });
    expect(r.today.dutyPerMonth).toEqual({ low: 11000, high: 11000 });
    expect(r.future.totalRate).toEqual(r.today.totalRate);
    // $26.79 + $25 to $75 default broker fee = $51.79 to $101.79 a shipment; x 4 = $207.16 to $407.16.
    expect(r.fees.brokerFeeIsEstimate).toBe(true);
    expect(r.fees.perShipment).toEqual({ low: 51.79, high: 101.79 });
    expect(r.fees.perMonth).toEqual({ low: 207.16, high: 407.16 });
  });

  it("C. general goods from Japan with a 4% base rate, $5,000 x 3 a month, $40 broker fee", () => {
    const r = computeLandedCost(
      input({ countryId: "japan", declaredValue: 5000, shipmentsPerMonth: 3, baseRatePct: 4, brokerFeePerEntry: 40 }),
      tariffRules,
    );
    // Japan's 12.5% includes the base duty: 8.5% added on top of the 4% base = 12.5%.
    expect(r.today.totalRate).toEqual({ low: 12.5, high: 12.5 });
    expect(r.today.dutyPerShipment).toEqual({ low: 625, high: 625 });
    expect(r.today.dutyPerMonth).toEqual({ low: 1875, high: 1875 });
    // $26.79 + $40 = $66.79 a shipment, $200.37 a month.
    expect(r.fees.perShipment).toEqual({ low: 66.79, high: 66.79 });
    expect(r.fees.perMonth).toEqual({ low: 200.37, high: 200.37 });
  });
});

describe("calculator rules", () => {
  it("leaves the base rate out of the totals when no HTS code is given", () => {
    const r = computeLandedCost(input({ declaredValue: 1000 }), tariffRules);
    expect(r.today.includesBaseRate).toBe(false);
    expect(r.today.totalRate).toEqual({ low: 12.5, high: 12.5 });
    expect(r.today.dutyPerShipment).toEqual({ low: 125, high: 125 });
  });

  it("shows both Section 301 rates for a country not on the list", () => {
    const r = computeLandedCost(input({ countryId: "other", baseRatePct: 0 }), tariffRules);
    expect(r.today.totalRate).toEqual({ low: 10, high: 12.5 });
  });

  it("raises upholstered furniture to 30% on January 1, 2027", () => {
    const r = computeLandedCost(input({ categoryId: "upholstered_furniture", countryId: "uk", baseRatePct: 0 }), tariffRules);
    expect(r.today.layers.find((l) => l.id === "s232")!.rate).toEqual({ low: 25, high: 25 });
    expect(r.future.layers.find((l) => l.id === "s232")!.rate).toEqual({ low: 30, high: 30 });
  });

  it("shows both possibilities when an exemption is marked unconfirmed", () => {
    const rules = structuredClone(tariffRules);
    rules.facts["s301-exemptions"]!.verify = true;
    rules.facts["s301-net-of-mfn"]!.verify = true;
    const cabinets = computeLandedCost(input({ categoryId: "kitchen_cabinets", countryId: "vietnam", baseRatePct: 0 }), rules);
    expect(cabinets.today.totalRate).toEqual({ low: 25, high: 37.5 });
    const japan = computeLandedCost(input({ countryId: "japan", baseRatePct: 4 }), rules);
    expect(japan.today.totalRate).toEqual({ low: 12.5, high: 16.5 });
  });

  it("splits semiconductors and footnotes the Section 232 country terms on the 232 line", () => {
    const chips = computeLandedCost(input({ categoryId: "advanced_chips", baseRatePct: 0 }), tariffRules);
    expect(chips.today.layers.find((l) => l.id === "s232")!.rate).toEqual({ low: 25, high: 25 });
    const other = computeLandedCost(input({ categoryId: "semiconductors", baseRatePct: 0 }), tariffRules);
    expect(other.today.layers.find((l) => l.id === "s232")!.rate).toBeNull();
    const ukFurniture = computeLandedCost(input({ categoryId: "upholstered_furniture", countryId: "uk", baseRatePct: 0 }), tariffRules);
    expect(ukFurniture.today.layers.find((l) => l.id === "s232")!.facts).toContain("s232-country-deals");
    expect(ukFurniture.today.layers.find((l) => l.id === "s301")!.facts).not.toContain("s232-country-deals");
  });

  it("shows the metal derivatives range", () => {
    const r = computeLandedCost(input({ categoryId: "metal_derivatives", baseRatePct: 0 }), tariffRules);
    expect(r.today.layers.find((l) => l.id === "s232")!.rate).toEqual({ low: 25, high: 50 });
  });
});

describe("parseAdValorem", () => {
  it("reads Free and plain percents, and refuses anything else", () => {
    expect(parseAdValorem("Free")).toBe(0);
    expect(parseAdValorem("2.5%")).toBe(2.5);
    expect(parseAdValorem(" 26.4% ")).toBe(26.4);
    expect(parseAdValorem("4.4¢/kg")).toBeNull();
    expect(parseAdValorem("46.3¢/kg + 14.9%")).toBeNull();
    expect(parseAdValorem("")).toBeNull();
  });
});
