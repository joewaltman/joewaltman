import { describe, expect, it } from "vitest";
import { type HtsRow, formatHts, pickGeneralRate } from "./hts";

// Trimmed from real responses of https://hts.usitc.gov/reststop/search (2026 HTS Revision 21).
const kitchen: HtsRow[] = [
  { htsno: "9403.40.90", indent: "3", description: "Other", general: "Free" },
  { htsno: "9403.40.90.40", indent: "4", description: "Kitchen cabinets", general: "" },
  { htsno: "9403.40.90.60", indent: "4", description: "Other", general: "" },
];
const steel: HtsRow[] = [
  { htsno: "7308.90.30", indent: "3", description: "Columns, pillars", general: "" },
  { htsno: "7308.90.30.00", indent: "4", description: "Columns, pillars", general: "Free" },
];
const autoParts: HtsRow[] = [
  { htsno: "8708.29.51", indent: "3", description: "Other", general: "2.5% <u></u>" },
  { htsno: "8708.29.51.60", indent: "4", description: "Other", general: "" },
];
const compound: HtsRow[] = [{ htsno: "1806.20.24", description: "Other", general: "46.3¢/kg + 14.9%" }];

describe("pickGeneralRate", () => {
  it("uses the 8-digit rate for a statistical 10-digit code", () => {
    expect(pickGeneralRate(kitchen, "9403.40.90.40")).toEqual({
      htsNumber: "9403.40.90",
      description: "Other",
      generalRateText: "Free",
      adValoremPct: 0,
    });
  });

  it("falls back to the merged 10-digit line ending in 00", () => {
    expect(pickGeneralRate(steel, "73089030")?.generalRateText).toBe("Free");
    expect(pickGeneralRate(steel, "73089030")?.htsNumber).toBe("7308.90.30.00");
  });

  it("strips markup from the rate text", () => {
    expect(pickGeneralRate(autoParts, "8708.29.51")).toMatchObject({ generalRateText: "2.5%", adValoremPct: 2.5 });
  });

  it("keeps compound rates as text without a percent", () => {
    expect(pickGeneralRate(compound, "1806.20.24")).toMatchObject({ adValoremPct: null });
  });

  it("needs at least 8 digits and a matching row", () => {
    expect(pickGeneralRate(kitchen, "9403.40")).toBeNull();
    expect(pickGeneralRate(kitchen, "9999.99.99")).toBeNull();
  });

  it("formats digits with dots", () => {
    expect(formatHts("9403409040")).toBe("9403.40.90.40");
    expect(formatHts("94034090")).toBe("9403.40.90");
  });
});
