import {
  type AiworkObligation,
  type AiworkResult,
  type AiworkRules,
  type Answers,
  evaluateAiwork,
  formatLongDate,
  obligationGroups,
} from "@jw/content";
import { type Db, and, eq, normalizeEmail, questionnaireResponses, subscribers } from "@jw/db";
import { type SendDeps, aiworkResult, sendEmail } from "@jw/email";
import { logEvent } from "./events";
import { createPendingSubscription, upsertContact } from "./subscriptions";

export const AIWORK_HAND_RAISE = "Want help choosing or implementing AI tools that stay inside these rules?";

// Open to visitors once an attorney's review is recorded, or since Joe chose to launch without one.
export const aiworkOpen = (rules: AiworkRules) => Boolean((rules.review.reviewedBy && rules.review.reviewedOn) || rules.review.launchedWithoutReview);

type Standing = Pick<AiworkResult, "reviewedBy" | "reviewedOn"> & { launchedWithoutReview?: string | null };

export function standingLine(result: Standing, preview: boolean): string {
  if (result.reviewedBy && result.reviewedOn) {
    return `This is an information tool, not legal advice. Reviewed by ${result.reviewedBy} as of ${formatLongDate(result.reviewedOn)}.`;
  }
  if (result.launchedWithoutReview && !preview) {
    return "This is an information tool, not legal advice, and it has not been reviewed by an attorney. It is built from the regulations and law firm summaries listed under Sources. Where they leave a point open, it makes an assumption, numbered in the footnotes. Talk to an employment attorney before acting on it.";
  }
  return "Draft for attorney review. This is an information tool, not legal advice, and these rules have not been reviewed by an attorney yet.";
}

// "text [1]" for email.
const marked = (text: string, notes: number[] = []) => `${text}${notes.map((n) => ` [${n}]`).join("")}`;

// Summary, what to do, and the "not sure" check, as plain lines for email.
export function obligationLines(o: AiworkObligation): string[] {
  return [
    ...(o.checkFirst ? [`Check first: ${o.checkFirst}`] : []),
    ...o.summary.map((s) => marked(s.text, s.notes)),
    ...o.actions.map((a) => `To do: ${marked(a.text.text, a.text.notes)}`),
  ];
}

export interface AiworkSubmission {
  answers: Answers;
  wantsUpdates: boolean;
  partnerSlug: string | null;
  // Joe previewing before the attorney review sees everything, marked as a draft.
  preview: boolean;
  today: string;
}

export async function submitAiwork(deps: SendDeps, rules: AiworkRules, input: AiworkSubmission): Promise<{ responseId: string; emailStatus: string }> {
  const { db, config } = deps;
  const rawEmail = input.answers.email;
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : null;
  const result = evaluateAiwork(input.answers, rules, input.preview ? "admin" : "public");
  const { email: _omit, ...answers } = input.answers;
  const keepContact = email !== null && (config.mode !== "joe-only" || email === config.adminEmail);
  const subscriber = keepContact ? await upsertContact(db, { email: email!, partnerSlug: input.partnerSlug }) : null;

  const [row] = await db
    .insert(questionnaireResponses)
    .values({
      tool: "aiwork",
      subscriberId: subscriber?.id ?? null,
      answers: { ...answers, partnerSlug: input.partnerSlug, wantsUpdates: input.wantsUpdates, preview: input.preview },
      result: result as unknown as Record<string, unknown>,
      rulesVersion: result.rulesVersion,
    })
    .returning({ id: questionnaireResponses.id });
  const responseId = row!.id;
  await logEvent(db, { type: "result_viewed", tool: "aiwork", subscriberId: subscriber?.id ?? null, meta: { responseId, obligations: result.obligations.map((o) => o.id) } });

  if (!subscriber || !email) return { responseId, emailStatus: "not-open" };
  let confirmUrl: string | null = null;
  if (input.wantsUpdates) {
    const token = await createPendingSubscription(db, { subscriberId: subscriber.id, email, tool: "aiwork" });
    confirmUrl = `${config.siteUrl}/confirm/${token}`;
  }
  const groups = obligationGroups(result, input.today).map((g) => ({ heading: g.heading, items: g.items.map((o) => ({ title: marked(o.title, o.notes), lines: obligationLines(o) })) }));
  const sent = await sendEmail(deps, {
    to: email,
    template: aiworkResult({
      standing: standingLine(result, input.preview),
      groups,
      notTriggered: result.notTriggered.map((l) => l.name),
      assumptions: (result.assumptions ?? []).map((a, i) => `[${i + 1}] ${a.text}`),
      resultUrl: `${config.siteUrl}/aiwork/result/${responseId}`,
      updatesUrl: confirmUrl,
      asOf: formatLongDate(result.asOf),
    }),
    reason: "You got this because you asked for your result at joewaltman.com/aiwork.",
    subscriber: { id: subscriber.id, unsubscribeToken: subscriber.unsubscribeToken },
    showForward: true,
  });
  return { responseId, emailStatus: sent.status };
}

export async function loadAiworkResponse(db: Db, id: string) {
  const [row] = await db
    .select({ id: questionnaireResponses.id, answers: questionnaireResponses.answers, result: questionnaireResponses.result, createdAt: questionnaireResponses.createdAt })
    .from(questionnaireResponses)
    .leftJoin(subscribers, eq(questionnaireResponses.subscriberId, subscribers.id))
    .where(and(eq(questionnaireResponses.id, id), eq(questionnaireResponses.tool, "aiwork")))
    .limit(1);
  if (!row) return null;
  const meta = row.answers as { partnerSlug?: string | null; preview?: boolean };
  return {
    id: row.id,
    result: row.result as unknown as AiworkResult,
    partnerSlug: typeof meta.partnerSlug === "string" ? meta.partnerSlug : null,
    preview: meta.preview === true,
    createdAt: row.createdAt,
  };
}
