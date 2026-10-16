import {
  type Answers,
  type TariffResult,
  type TariffRules,
  brokerSummary,
  evaluateTariff,
} from "@jw/content";
import {
  type Db,
  and,
  eq,
  isNotNull,
  normalizeEmail,
  partners,
  questionnaireResponses,
  subscribers,
} from "@jw/db";
import { type SendDeps, brokerReviewRequest, sendEmail, tariffResult } from "@jw/email";
import { logEvent } from "./events";
import { createPendingSubscription, upsertContact } from "./subscriptions";

export const EMAIL_QUESTION = "email";

export interface TariffSubmission {
  answers: Answers;
  wantsUpdates: boolean;
  partnerSlug: string | null;
  // Shown in the summary; passed in so tests get a fixed date.
  today: string;
}

export interface StoredTariffResponse {
  id: string;
  answers: Answers;
  result: TariffResult;
  partnerSlug: string | null;
  email: string | null;
}

export interface ResultItem {
  text: string;
  // Footnote numbers for the assumptions behind this item. Results saved before footnotes existed have none.
  notes: number[];
}

const item = (t: { text: string; notes?: number[] }): ResultItem => ({ text: t.text, notes: t.notes ?? [] });

export function resultSections(result: TariffResult): Array<{ title: string; items: ResultItem[] }> {
  return [
    { title: "Next steps", items: result.path.steps.map(item) },
    ...result.actions.map((a) => ({ title: a.title, items: a.body.map(item) })),
    { title: "Documents to gather", items: result.path.documents.map(item) },
    { title: "Deadlines", items: result.path.deadlines.map(item) },
  ].filter((s) => s.items.length > 0);
}

// Plain-text form for email: "text [1]".
export const withMarkers = (i: ResultItem) => `${i.text}${i.notes.map((n) => ` [${n}]`).join("")}`;

// Saves the answers, emails the result, and when asked, starts a double opt-in for rule-change updates.
export async function submitTariff(
  deps: SendDeps,
  rules: TariffRules,
  input: TariffSubmission,
): Promise<{ responseId: string; emailStatus: string }> {
  const { db, config } = deps;
  const rawEmail = input.answers[EMAIL_QUESTION];
  const email = typeof rawEmail === "string" ? normalizeEmail(rawEmail) : null;
  const result = evaluateTariff(input.answers, rules, "public");
  // The email lives on the subscriber row, not in the stored answers.
  const { [EMAIL_QUESTION]: _omit, ...answers } = input.answers;

  // In joe-only mode, keep nothing that identifies anyone but Joe.
  const keepContact = email !== null && (config.mode !== "joe-only" || email === config.adminEmail);
  const subscriber = keepContact
    ? await upsertContact(db, { email: email!, partnerSlug: input.partnerSlug })
    : null;

  const [row] = await db
    .insert(questionnaireResponses)
    .values({
      tool: "tariff",
      subscriberId: subscriber?.id ?? null,
      answers: { ...answers, partnerSlug: input.partnerSlug, wantsUpdates: input.wantsUpdates },
      result: result as unknown as Record<string, unknown>,
      rulesVersion: result.rulesVersion,
    })
    .returning({ id: questionnaireResponses.id });
  const responseId = row!.id;

  await logEvent(db, {
    type: "result_viewed",
    tool: "tariff",
    subscriberId: subscriber?.id ?? null,
    meta: { path: result.pathId, rule: result.ruleId, responseId },
  });

  if (!subscriber || !email) return { responseId, emailStatus: "not-open" };

  let confirmUrl: string | null = null;
  if (input.wantsUpdates) {
    const token = await createPendingSubscription(db, {
      subscriberId: subscriber.id,
      email,
      tool: "tariff",
    });
    confirmUrl = `${config.siteUrl}/confirm/${token}`;
  }

  const summaryText = brokerSummary({ answers, result, rules, preparedOn: input.today });
  const assumptions = result.assumptions ?? [];
  const template = tariffResult({
    pathTitle: result.path.title,
    summary: result.path.summary.map((s) => withMarkers(item(s))),
    sections: [
      ...resultSections(result).map((sec) => ({ title: sec.title, items: sec.items.map(withMarkers) })),
      ...(assumptions.length > 0
        ? [{ title: "Assumptions", items: assumptions.map((a, i) => `[${i + 1}] ${a.text}`) }]
        : []),
      ...(confirmUrl
        ? [{ title: "Updates", items: [`Confirm you want an email when refund rules or deadlines change: ${confirmUrl}`] }]
        : []),
    ],
    resultUrl: `${config.siteUrl}/tariffrefund/result/${responseId}`,
    brokerSummary: summaryText,
    asOf: result.asOf,
  });
  const sent = await sendEmail(deps, {
    to: email,
    template,
    reason: "You got this because you asked for your result at joewaltman.com/tariffrefund.",
    subscriber: { id: subscriber.id, unsubscribeToken: subscriber.unsubscribeToken },
    showForward: true,
  });
  return { responseId, emailStatus: sent.status };
}

export async function loadTariffResponse(db: Db, id: string): Promise<StoredTariffResponse | null> {
  const [row] = await db
    .select({
      id: questionnaireResponses.id,
      answers: questionnaireResponses.answers,
      result: questionnaireResponses.result,
      email: subscribers.email,
    })
    .from(questionnaireResponses)
    .leftJoin(subscribers, eq(questionnaireResponses.subscriberId, subscribers.id))
    .where(and(eq(questionnaireResponses.id, id), eq(questionnaireResponses.tool, "tariff")))
    .limit(1);
  if (!row) return null;
  const { partnerSlug, wantsUpdates: _w, ...answers } = row.answers as Answers & {
    partnerSlug?: string | null;
    wantsUpdates?: boolean;
  };
  return {
    id: row.id,
    answers,
    result: row.result as unknown as TariffResult,
    partnerSlug: typeof partnerSlug === "string" ? partnerSlug : null,
    email: row.email,
  };
}

// The broker who gets "ask a broker to review" requests: the partner the visitor came through,
// or the default set in TARIFF_BROKER_SLUG. Null hides the button.
export async function reviewBroker(db: Db, partnerSlug: string | null, defaultSlug: string | null) {
  for (const slug of [partnerSlug, defaultSlug]) {
    if (!slug) continue;
    const [p] = await db
      .select()
      .from(partners)
      .where(and(eq(partners.slug, slug), eq(partners.tool, "tariff"), isNotNull(partners.contactEmail)))
      .limit(1);
    if (p) return p;
  }
  return null;
}

export async function requestBrokerReview(
  deps: SendDeps,
  rules: TariffRules,
  input: { responseId: string; defaultBrokerSlug: string | null; today: string },
): Promise<"sent" | "no-broker" | "no-email" | "not-found" | "failed"> {
  const stored = await loadTariffResponse(deps.db, input.responseId);
  if (!stored) return "not-found";
  if (!stored.email) return "no-email";
  const broker = await reviewBroker(deps.db, stored.partnerSlug, input.defaultBrokerSlug);
  if (!broker?.contactEmail) return "no-broker";

  const summaryText = brokerSummary({
    answers: stored.answers,
    result: stored.result,
    rules,
    preparedOn: input.today,
  });
  const sent = await sendEmail(deps, {
    to: broker.contactEmail,
    template: brokerReviewRequest({
      brokerName: broker.name,
      importerEmail: stored.email,
      brokerSummary: summaryText,
    }),
    reason: `You got this because ${stored.email} asked the Tariff Refund Tool to send their summary to you, and you agreed to receive these requests.`,
    replyTo: stored.email,
  });
  await logEvent(deps.db, {
    type: "broker_review",
    tool: "tariff",
    meta: { responseId: stored.id, partner: broker.slug, emailStatus: sent.status },
  });
  return sent.status === "sent" || sent.status === "dryrun" ? "sent" : "failed";
}
