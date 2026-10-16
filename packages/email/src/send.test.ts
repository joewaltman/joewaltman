import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Db, emailSends, subscribers, suppressions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import type { EmailConfig } from "./config";
import { sendEmail } from "./send";
import { confirmSubscription, magicLink } from "./templates";
import type { OutgoingMessage, Transport } from "./transport";

function fakeTransport() {
  const sent: OutgoingMessage[] = [];
  const transport: Transport = {
    async send(m) {
      sent.push(m);
      return { id: `fake-${sent.length}` };
    },
  };
  return { sent, transport };
}

async function config(overrides: Partial<EmailConfig> = {}): Promise<EmailConfig> {
  return {
    mode: "dryrun",
    adminEmail: "joe@joewaltman.com",
    from: "Joe Waltman <joe@mail.joewaltman.com>",
    replyTo: "joe@joewaltman.com",
    siteUrl: "https://joewaltman.com",
    postalAddress: "PO Box 1, Encinitas, CA 92024",
    resendApiKey: null,
    dryRunDir: await mkdtemp(path.join(tmpdir(), "jw-email-")),
    ...overrides,
  };
}

const template = () =>
  confirmSubscription({ toolName: "Tariff Refund Tool", confirmUrl: "https://x/confirm" });

let db: Db;
let subscriber: { id: string; unsubscribeToken: string };
beforeEach(async () => {
  db = await createTestDb();
  const [row] = await db
    .insert(subscribers)
    .values({ email: "client@example.com", unsubscribeToken: "tok123" })
    .returning();
  subscriber = { id: row!.id, unsubscribeToken: row!.unsubscribeToken };
});

describe("sendEmail", () => {
  it("dry run writes the email to disk and logs it", async () => {
    const cfg = await config();
    const result = await sendEmail(
      { db, config: cfg },
      { to: "Someone@Example.com", template: template(), reason: "You signed up." },
    );
    expect(result.status).toBe("dryrun");
    const html = await readFile(result.dryRunFile!, "utf8");
    expect(html).toContain("To: someone@example.com");
    expect(html).toContain("PO Box 1, Encinitas, CA 92024");
    const rows = await db.select().from(emailSends);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("dryrun");
  });

  it("joe-only mode refuses anyone but the admin", async () => {
    const { sent, transport } = fakeTransport();
    const cfg = await config({ mode: "joe-only" });
    const blocked = await sendEmail(
      { db, config: cfg, transport },
      { to: "client@example.com", template: template(), reason: "r" },
    );
    expect(blocked.status).toBe("blocked");
    const ok = await sendEmail(
      { db, config: cfg, transport },
      { to: "joe@joewaltman.com", template: template(), reason: "r" },
    );
    expect(ok.status).toBe("sent");
    expect(sent.map((m) => m.to)).toEqual(["joe@joewaltman.com"]);
  });

  it("honors suppression in every mode", async () => {
    await db.insert(suppressions).values({ email: "gone@example.com", reason: "unsubscribe" });
    for (const mode of ["dryrun", "joe-only", "live"] as const) {
      const { sent, transport } = fakeTransport();
      const result = await sendEmail(
        { db, config: await config({ mode }), transport },
        { to: "GONE@example.com", template: template(), reason: "r" },
      );
      expect(result.status).toBe("suppressed");
      expect(sent).toHaveLength(0);
    }
  });

  it("lets the admin sign-in link through suppression when asked", async () => {
    await db.insert(suppressions).values({ email: "joe@joewaltman.com", reason: "unsubscribe" });
    const { sent, transport } = fakeTransport();
    const result = await sendEmail(
      { db, config: await config({ mode: "joe-only" }), transport },
      {
        to: "joe@joewaltman.com",
        template: magicLink({ url: "https://x/login" }),
        reason: "r",
        bypassSuppression: true,
      },
    );
    expect(result.status).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("refuses live mail without a postal address", async () => {
    const { sent, transport } = fakeTransport();
    const result = await sendEmail(
      { db, config: await config({ mode: "live", postalAddress: null }), transport },
      { to: "client@example.com", template: template(), reason: "r" },
    );
    expect(result.status).toBe("failed");
    expect(sent).toHaveLength(0);
  });

  it("adds one-click unsubscribe headers and footer for list mail", async () => {
    const { sent, transport } = fakeTransport();
    const result = await sendEmail(
      { db, config: await config({ mode: "live" }), transport },
      {
        to: "client@example.com",
        template: template(),
        reason: "You subscribed to the Tariff Refund Tool.",
        subscriber,
        showForward: true,
      },
    );
    expect(result.status).toBe("sent");
    const m = sent[0]!;
    expect(m.headers["List-Unsubscribe"]).toBe("<https://joewaltman.com/api/unsubscribe?t=tok123>");
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.html).toContain("https://joewaltman.com/u/tok123");
    expect(m.text).toContain("Forward it to them");
    expect(m.text).toContain("PO Box 1, Encinitas, CA 92024");
    expect(m.replyTo).toBe("joe@joewaltman.com");
  });

  it("never uses an em dash in templates", async () => {
    const { sent, transport } = fakeTransport();
    const cfg = await config({ mode: "live" });
    for (const t of [template(), magicLink({ url: "https://x" })]) {
      await sendEmail({ db, config: cfg, transport }, { to: "a@example.com", template: t, reason: "r", subscriber });
    }
    for (const m of sent) {
      expect(m.subject + m.text).not.toMatch(/—/);
    }
  });
});
