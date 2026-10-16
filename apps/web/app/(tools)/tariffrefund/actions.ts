"use server";

import { readAnswers, tariffRules } from "@jw/content";
import { redirect } from "next/navigation";
import { z } from "zod";
import { emailDeps } from "@/lib/server";
import { requestBrokerReview, submitTariff } from "@/lib/tariff";
import { todayLabel } from "@/lib/tariff-view";

const slug = z.string().regex(/^[a-z0-9-]{2,60}$/);

export async function tariffSubmitAction(form: FormData): Promise<void> {
  const partner = slug.safeParse(form.get("partner"));
  const back = partner.success ? `/tariffrefund/p/${partner.data}` : "/tariffrefund";
  const { answers, errors } = readAnswers(tariffRules, form);
  if (Object.keys(errors).length > 0) {
    const first = Object.keys(errors)[0]!;
    redirect(`${back}?error=${encodeURIComponent(first)}#q-${first}`);
  }
  const { responseId, emailStatus } = await submitTariff(emailDeps(), tariffRules, {
    answers,
    wantsUpdates: form.get("updates") === "yes",
    partnerSlug: partner.success ? partner.data : null,
    today: todayLabel(),
  });
  redirect(`/tariffrefund/result/${responseId}?emailed=${emailStatus}`);
}

export async function brokerReviewAction(form: FormData): Promise<void> {
  const id = z.uuid().safeParse(form.get("responseId"));
  if (!id.success) redirect("/tariffrefund");
  if (form.get("consent") !== "yes") redirect(`/tariffrefund/result/${id.data}?review=consent#broker`);
  const outcome = await requestBrokerReview(emailDeps(), tariffRules, {
    responseId: id.data,
    defaultBrokerSlug: process.env.TARIFF_BROKER_SLUG || null,
    today: todayLabel(),
  });
  redirect(`/tariffrefund/result/${id.data}?review=${outcome}#broker`);
}
