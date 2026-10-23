import { describe, expect, it } from "vitest";
import { sourceLinks } from "./sources";

describe("source link labels", () => {
  it("numbers a site that appears twice", () => {
    expect(sourceLinks(["https://www.cppa.ca.gov/a", "https://littler.com/b", "https://cppa.ca.gov/c"]).map((s) => s.label)).toEqual(["cppa.ca.gov", "littler.com", "cppa.ca.gov (2)"]);
  });
});
