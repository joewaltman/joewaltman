import { tariffRules } from "@jw/content";
import { type Db, events, partners, questionnaireResponses, subscribers, subscriptions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { EmailConfig, OutgoingMessage, SendDeps, Transport } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmByToken } from "./subscriptions";
import { loadTariffResponse, requestBrokerReview, submitTariff } from "./tariff";

const ADMIN = "joe@joewaltman.com";
let db: Db;
let sent: OutgoingMessage[];

function deps(mode: EmailConfig["mode"] = "live"): SendDeps {
  const transport: Transport = {
    async send(m) {
      sent.push(m);
      return { id: `fake-${sent.length}` };
    },
  };
  return {
    db,
    transport,
    config: {
      mode,
      adminEmail: ADMIN,
      from: "Joe Waltman <joe@joewaltman.com>",
      replyTo: ADMIN,
      siteUrl: "https://joewaltman.com",
      postalAddress: "PO Box 1, Encinitas, CA 92024",
      resendApiKey: null,
      dryRunDir: "/tmp/unused",
    },
  };
}

const answers = {
  imported: "yes",
  ieepaPaid: "yes",
  importerOfRecord: "self",
  aceAccess: "yes",
  entryStatus: "final",
  actionsTaken: ["none"],
  achOnFile: "no",
  dutyBand: "50k_250k",
  brokers: "Acme Customs",
  email: "Importer@Example.com",
};

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
});

describe("submitTariff", () => {
  it("saves the result without the email, and emails the result with a broker summary", async () => {
    const { responseId, emailStatus } = await submitTariff(deps(), tariffRules, {
      answers,
      wantsUpdates: false,
      partnerSlug: null,
      today: "October 16, 2026",
    });
    expect(emailStatus).toBe("sent");
    const [row] = await db.select().from(questionnaireResponses);
    expect(row!.id).toBe(responseId);
    expect(row!.answers).not.toHaveProperty("email");
    expect((row!.result as { pathId: string }).pathId).toBe("class");
    expect(row!.rulesVersion).toBe(tariffRules.version);

    const m = sent[0]!;
    expect(m.to).toBe("importer@example.com");
    expect(m.subject).toBe("Your tariff refund path: The Freestyle World class action");
    expect(m.text).toContain("IEEPA tariff refund: summary for my customs broker");
    expect(m.text).toContain("Acme Customs");
    expect(m.text).toContain(`https://joewaltman.com/tariffrefund/result/${responseId}`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // Nobody is subscribed to updates without asking.
    expect(await db.select().from(subscriptions)).toHaveLength(0);
    const [ev] = await db.select().from(events);
    expect(ev!.type).toBe("result_viewed");
  });

  it("puts a confirm link for updates in the same email when asked", async () => {
    await submitTariff(deps(), tariffRules, { answers, wantsUpdates: true, partnerSlug: null, today: "x" });
    expect(sent).toHaveLength(1);
    const token = sent[0]!.text.match(/https:\/\/joewaltman\.com\/confirm\/([A-Za-z0-9_-]+)/)![1]!;
    const [sub] = await db.select().from(subscriptions);
    expect(sub!.active).toBe(false);
    expect(await confirmByToken(db, token)).toEqual({ email: "importer@example.com", tool: "tariff" });
  });

  it("keeps no contact details for other people in joe-only mode", async () => {
    const { emailStatus } = await submitTariff(deps("joe-only"), tariffRules, {
      answers,
      wantsUpdates: true,
      partnerSlug: null,
      today: "x",
    });
    expect(emailStatus).toBe("not-open");
    expect(sent).toHaveLength(0);
    expect(await db.select().from(subscribers)).toHaveLength(0);
    const [row] = await db.select().from(questionnaireResponses);
    expect(row!.subscriberId).toBeNull();
  });
});

describe("requestBrokerReview", () => {
  it("sends the summary to the partner broker with the importer as reply-to", async () => {
    await db.insert(partners).values({
      slug: "acme",
      name: "Acme Customs",
      tool: "tariff",
      contactEmail: "desk@acme.example",
    });
    const { responseId } = await submitTariff(deps(), tariffRules, {
      answers,
      wantsUpdates: false,
      partnerSlug: "acme",
      today: "x",
    });
    const stored = await loadTariffResponse(db, responseId);
    expect(stored!.partnerSlug).toBe("acme");
    expect(stored!.email).toBe("importer@example.com");

    const outcome = await requestBrokerReview(deps(), tariffRules, {
      responseId,
      defaultBrokerSlug: null,
      today: "x",
    });
    expect(outcome).toBe("sent");
    const m = sent.at(-1)!;
    expect(m.to).toBe("desk@acme.example");
    expect(m.replyTo).toBe("importer@example.com");
    expect(m.text).toContain("summary for my customs broker");
  });

  it("does nothing without a tariff broker partner", async () => {
    const { responseId } = await submitTariff(deps(), tariffRules, {
      answers,
      wantsUpdates: false,
      partnerSlug: null,
      today: "x",
    });
    expect(await requestBrokerReview(deps(), tariffRules, { responseId, defaultBrokerSlug: "nope", today: "x" })).toBe(
      "no-broker",
    );
  });
});
