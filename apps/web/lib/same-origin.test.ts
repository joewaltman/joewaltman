import { describe, expect, it } from "vitest";
import { sameOrigin } from "./same-origin";

const req = (headers: Record<string, string>) => new Request("http://internal:8080/api/forms/signup", { method: "POST", headers });

describe("sameOrigin", () => {
  it("accepts a post from the site, including behind the proxy", () => {
    expect(sameOrigin(req({ origin: "https://joewaltman.com", host: "joewaltman.com" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://joewaltman.com", host: "internal:8080", "x-forwarded-host": "joewaltman.com" }))).toBe(true);
    expect(sameOrigin(req({ host: "joewaltman.com" }))).toBe(true);
  });
  it("rejects a post from another site", () => {
    expect(sameOrigin(req({ origin: "https://evil.example", host: "joewaltman.com" }))).toBe(false);
    expect(sameOrigin(req({ origin: "not a url", host: "joewaltman.com" }))).toBe(false);
  });
});
