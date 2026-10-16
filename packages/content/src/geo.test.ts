import { describe, expect, it } from "vitest";
import { categoryForNaics, clusterForZip, countyForZip, taxonomy, zipClusters } from "./geo";

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
