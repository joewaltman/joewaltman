import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv([{ a: 'say "hi", ok', b: "line1\nline2", c: null }]);
    expect(csv).toBe('a,b,c\r\n"say ""hi"", ok","line1\nline2",\r\n');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(toCsv([{ a: "=HYPERLINK(1)" }])).toBe("a\r\n'=HYPERLINK(1)\r\n");
  });

  it("writes dates as ISO and objects as JSON", () => {
    const csv = toCsv([{ d: new Date("2026-10-16T00:00:00Z"), o: { x: 1 } }]);
    expect(csv).toBe('d,o\r\n2026-10-16T00:00:00.000Z,"{""x"":1}"\r\n');
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
