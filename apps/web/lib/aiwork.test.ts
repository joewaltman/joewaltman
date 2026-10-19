import { aiworkRules } from "@jw/content";
import { type Db, questionnaireResponses, subscriptions } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage, SendDeps } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { aiworkOpen, loadAiworkResponse, standingLine, submitAiwork } from "./aiwork";
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
  it("is open to visitors since Joe launched it without attorney review", () => {
    expect(aiworkOpen(aiworkRules)).toBe(true);
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
    expect(mail.text).toContain("IN EFFECT NOW (SINCE OCTOBER 1, 2025)");
    expect(mail.text).toContain("BY JULY 1, 2027");
    // Red for what is in force now, amber for the July 2027 deadline.
    expect(mail.html).toContain("#d92d20");
    expect(mail.html).toContain("#f79009");
    expect(mail.text).toContain(`https://joewaltman.com/aiwork/result/${responseId}`);
    expect(mail.text).toContain("https://joewaltman.com/confirm/");
    expect(await db.select().from(subscriptions)).toMatchObject([{ tool: "aiwork", active: false }]);
  });

  it("gives visitors the full checklist with the caveat and numbered assumptions", async () => {
    const { responseId } = await submitAiwork(deps, aiworkRules, { answers: { ...answers, email: "owner@example.com" }, wantsUpdates: false, partnerSlug: null, preview: false, today: "2026-10-17" });
    const stored = await loadAiworkResponse(db, responseId);
    expect(stored!.preview).toBe(false);
    expect(stored!.result.obligations.map((o) => o.id)).toEqual(["crc-records", "crc-bias", "crc-accommodation", "sb947-human", "sb947-limits"]);
    expect(stored!.result.hidden).toEqual([]);
    expect(standingLine(stored!.result, false)).toMatch(/^This is an information tool, not legal advice, and it has not been reviewed by an attorney\./);
    const text = sent[0]!.text;
    expect(text).toContain("it has not been reviewed by an attorney");
    expect(text).toMatch(/four years, including the data the tool used and produced\. \[1\]/);
    expect(text).toContain("Assumptions");
    expect(text).toContain("[1] The regulations' examples focus on hiring.");
  });
});

describe("review packet", () => {
  it("lists every statement with its status and every obligation with its triggers", () => {
    const text = reviewPacket(aiworkRules);
    expect(text).toContain("[sb947-size] IN USE: SB 947 applies to employers of every size.");
    expect(text).toContain("Assumption: Neither source states a size threshold for SB 947");
    expect(text).toContain("[crc-ads-effective] IN USE:");
    expect(text).toContain("Shown when: Q8 (Does any automated tool feed into decisions about discipline, termination, promotion, or pay?) is Discipline or Termination or Not sure");
    expect(text).toContain("This notice is for a technology displacement.");
    expect(text).not.toMatch(/\u2014/);
  });
});
