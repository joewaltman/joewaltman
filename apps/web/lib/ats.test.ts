import { describe, expect, it } from "vitest";
import { detectAts, fetchableUrl } from "./ats";

describe("detectAts", () => {
  it("names the vendor from the careers URL or from embeds on the page", () => {
    expect(detectAts("https://boards.greenhouse.io/examplecorp")).toEqual([{ vendor: "Greenhouse", from: "url" }]);
    expect(detectAts("https://example.myworkdayjobs.com/en-US/careers")).toEqual([{ vendor: "Workday", from: "url" }]);
    expect(detectAts("https://www.example.com/careers", '<iframe src="https://jobs.lever.co/example"></iframe><script src="https://example.bamboohr.com/js/embed.js"></script>')).toEqual([
      { vendor: "Lever", from: "page" },
      { vendor: "BambooHR", from: "page" },
    ]);
    expect(detectAts("https://www.example.com/careers", "<p>Email us your resume.</p>")).toEqual([]);
  });

  it("refuses internal and non-web addresses", () => {
    expect(fetchableUrl("https://example.com/careers")?.hostname).toBe("example.com");
    expect(fetchableUrl("http://localhost:3000")).toBeNull();
    expect(fetchableUrl("http://postgres.railway.internal")).toBeNull();
    expect(fetchableUrl("http://10.0.0.1/")).toBeNull();
    expect(fetchableUrl("file:///etc/passwd")).toBeNull();
    expect(fetchableUrl("not a url")).toBeNull();
  });
});
