import { describe, expect, it } from "vitest";
import { categoryForNaics, clusterForZip, countyForZip, dcaLicenseTypes, npiGroup, taxonomy, zipClusters } from "./geo";

describe("zip clusters", () => {
  it("has the five San Diego County clusters", () => {
    expect(Object.keys(zipClusters.clusters)).toEqual([
      "north-county-coastal",
      "north-county-inland",
      "central-san-diego",
      "south-bay",
      "east-county",
    ]);
  });
  it("maps ZIPs, including ZIP+4, and leaves outside ZIPs alone", () => {
    expect(clusterForZip("92024")).toBe("north-county-coastal");
    expect(clusterForZip("92101-7514")).toBe("central-san-diego");
    expect(clusterForZip("91910")).toBe("south-bay");
    expect(clusterForZip("10601")).toBeNull();
    expect(countyForZip("92020")).toBe("San Diego");
    expect(countyForZip("33441")).toBeNull();
  });
});

describe("taxonomy", () => {
  it("has 20 categories", () => {
    expect(taxonomy.categories).toHaveLength(20);
  });
  it("uses the longest matching NAICS prefix", () => {
    expect(categoryForNaics("72232")).toBe("restaurants-bars");
    expect(categoryForNaics("621210")).toBe("dental");
    expect(categoryForNaics("621111")).toBe("medical");
    expect(categoryForNaics("541940")).toBe("veterinary");
    expect(categoryForNaics("541211")).toBe("accounting");
    expect(categoryForNaics("238220")).toBe("construction");
    expect(categoryForNaics("72111")).toBe("lodging-education-care");
    expect(categoryForNaics("99")).toBeNull();
    expect(categoryForNaics("")).toBeNull();
  });
});

describe("ABC license types", () => {
  it("names types and flags bars and restaurants", async () => {
    const { abcTypeName, isBarOrRestaurantType } = await import("./geo");
    expect(abcTypeName("41")).toBe("On-Sale Beer & Wine - Eating Place");
    expect(abcTypeName("2")).toBe("Winegrower");
    expect(abcTypeName("30")).toBeNull();
    expect(isBarOrRestaurantType("47")).toBe(true);
    expect(isBarOrRestaurantType("21")).toBe(false);
  });
});

describe("DCA license types", () => {
  it("maps every license type to a known category or none on purpose", () => {
    const uncategorized: string[] = [];
    for (const [folder, f] of Object.entries(dcaLicenseTypes.folders)) {
      for (const [type, t] of Object.entries(f.types)) if (!categoryForNaics(t.naics)) uncategorized.push(`${folder}: ${type}`);
    }
    // Security and electronics repair have no taxonomy category yet; the Radar lists them as "business".
    expect(uncategorized.sort()).toEqual([
      "ElectronicApplianceRepair_3900: Electronic Repair",
      "Funeral_4800: Funeral Director Establishment",
      "SecurityAndInvestigativeServices_0120: Alarm Company Operator",
      "SecurityAndInvestigativeServices_0120: Locksmith Company",
      "SecurityAndInvestigativeServices_0120: PPO Branch",
      "SecurityAndInvestigativeServices_0120: Private Investigator",
      "SecurityAndInvestigativeServices_0120: Private Patrol Operator",
    ]);
    expect(categoryForNaics(dcaLicenseTypes.folders.AutomotiveRepair_1310!.types["Automotive Repair Dealer"]!.naics)).toBe("auto");
    expect(categoryForNaics(dcaLicenseTypes.folders.MedicalBoard_0800!.types["Fictitious Name Permit"]!.naics)).toBe("medical");
  });
});

describe("NPI taxonomy groups", () => {
  it("picks the longest prefix and maps to categories", () => {
    expect(npiGroup("261QD0000X")).toMatchObject({ label: "dental clinic" });
    expect(npiGroup("261QM1300X")).toMatchObject({ label: "clinic or medical center" });
    expect(npiGroup("251300000X")!.skip).toBe(true);
    expect(npiGroup("999999999X")).toMatchObject({ label: "healthcare organization" });
    expect(categoryForNaics(npiGroup("122300000X")!.naics)).toBe("dental");
    expect(categoryForNaics(npiGroup("207X00000X")!.naics)).toBe("medical");
  });
});
