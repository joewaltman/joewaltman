import { describe, expect, it } from "vitest";
import { loadEmailConfig } from "./config";

describe("loadEmailConfig", () => {
  it("treats empty variables as unset, the way Railway passes unset references", () => {
    const c = loadEmailConfig({ EMAIL_MODE: "", EMAIL_FROM: " ", MAIL_POSTAL_ADDRESS: "", RESEND_API_KEY: "" });
    expect(c.mode).toBe("dryrun");
    expect(c.from).toBe("Joe Waltman <joe@joewaltman.com>");
    expect(c.postalAddress).toBeNull();
    expect(c.resendApiKey).toBeNull();
  });

  it("rejects an unknown mode", () => {
    expect(() => loadEmailConfig({ EMAIL_MODE: "loud" })).toThrow(/EMAIL_MODE/);
  });

  it("normalizes the admin address and strips a trailing slash from the site URL", () => {
    const c = loadEmailConfig({ ADMIN_EMAIL: "Joe@JoeWaltman.com", SITE_URL: "https://joewaltman.com/" });
    expect(c.adminEmail).toBe("joe@joewaltman.com");
    expect(c.replyTo).toBe("joe@joewaltman.com");
    expect(c.siteUrl).toBe("https://joewaltman.com");
  });
});
