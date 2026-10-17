import { aiworkRules } from "@jw/content";
import { type Db, questionnaireResponses, subscriptions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage, SendDeps } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { aiworkOpen, loadAiworkResponse, submitAiwork } from "./aiwork";
import { reviewPacket } from "./aiwork-packet";

let db: Db;
let sent: OutgoingMessage[];
let deps: SendDeps;
const answers = {
  employees: "25-74",
  ats: ["greenhouse"],
  aiScreening: "yes",
  autoScheduling: "no",
  monitoring: "no",
  emotionNeural: "no",
  restroomSurveillance: "no",
  automatedDecisions: ["termination"],
  ccpa: "no",
  aiCommunications: "no",
};

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  deps = {
    db,
    transport: { async send(m) { sent.push(m); return { id: `fake-${sent.length}` }; } },
    config: { mode: "live", adminEmail: "joewaltman@gmail.com", from: "Joe Waltman <joe@joewaltman.com>", replyTo: "joe@joewaltman.com", siteUrl: "https://joewaltman.com", postalAddress: "PO Box 1, Encinitas, CA 92024", resendApiKey: null, dryRunDir: "/tmp/unused" },
  };
});

describe("AI-at-Work submissions", () => {
  it("stays closed to visitors until an attorney review is recorded", () => {
    expect(aiworkOpen(aiworkRules)).toBe(false);
  });

  it("saves a preview with every obligation, marked as a draft, and emails it", async () => {
    const { responseId, emailStatus } = await submitAiwork(deps, aiworkRules, { answers: { ...answers, email: "Owner@Example.com" }, wantsUpdates: true, partnerSlug: null, preview: true, today: "2026-10-17" });
    expect(emailStatus).toBe("sent");
    const stored = await loadAiworkResponse(db, responseId);
    expect(stored!.preview).toBe(true);
    expect(stored!.result.obligations.map((o) => o.id)).toEqual(["crc-records", "crc-bias", "crc-accommodation", "sb947-human", "sb947-limits"]);
    const [row] = await db.select().from(questionnaireResponses);
    // The email is kept on the subscriber row, never in the answers.
    expect(JSON.stringify(row!.answers)).not.toContain("example.com");
    const mail = sent[0]!;
    expect(mail.to).toBe("owner@example.com");
    expect(mail.subject).toBe("Your California AI-at-Work checklist: 5 items");
    expect(mail.text).toContain("Draft for attorney review");
    expect(mail.text).toContain("In effect now (since October 1, 2025)");
    expect(mail.text).toContain("By July 1, 2027");
    expect(mail.text).toContain(`https://joewaltman.com/aiwork/result/${responseId}`);
    expect(mail.text).toContain("https://joewaltman.com/confirm/");
    expect(await db.select().from(subscriptions)).toMatchObject([{ tool: "aiwork", active: false }]);
  });

  it("shows visitors only confirmed obligations once open", async () => {
    const { responseId } = await submitAiwork(deps, aiworkRules, { answers, wantsUpdates: false, partnerSlug: null, preview: false, today: "2026-10-17" });
    const stored = await loadAiworkResponse(db, responseId);
    expect(stored!.result.obligations).toEqual([]);
    expect(stored!.result.hidden.length).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);
  });
});

describe("review packet", () => {
  it("lists every statement with its status and every obligation with its triggers", () => {
    const text = reviewPacket(aiworkRules);
    expect(text).toContain("[sb947-size] FOR REVIEW: SB 947 applies to employers of every size.");
    expect(text).toContain("[crc-ads-effective] CONFIRMED:");
    expect(text).toContain("Shown when: Q8 (Does any automated tool feed into decisions about discipline, termination, promotion, or pay?) is Discipline or Termination or Not sure");
    expect(text).toContain("This notice is for a technology displacement.");
    expect(text).not.toMatch(/\u2014/);
  });
});
