import { brokerSummary, tariffRules } from "@jw/content";
import { getDb } from "@jw/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AssumptionList, Notes } from "@/components/assumptions";
import { HandRaise } from "@/components/hand-raise";
import { loadTariffResponse, resultSections, reviewBroker } from "@/lib/tariff";
import { formatDate, todayLabel } from "@/lib/tariff-view";

export const metadata: Metadata = { title: "Your tariff refund path", robots: { index: false } };

const EMAILED: Record<string, string> = {
  sent: "A copy is on its way to your email.",
  dryrun: "A copy is on its way to your email.",
  suppressed: "This address unsubscribed earlier, so no copy was emailed. Save this page instead.",
  blocked: "Emailed results are not switched on yet. Save this page or copy the summary below.",
  "not-open": "Emailed results are not switched on yet. Save this page or copy the summary below.",
  failed: "The email copy did not go out. Save this page or copy the summary below.",
};

const REVIEW: Record<string, string> = {
  sent: "Sent. The broker will reply to you by email.",
  consent: "Check the box to agree to share your summary first.",
  "no-email": "We need your email on the result before a broker can reply.",
  "no-broker": "No partner broker is set up for review yet.",
  "not-found": "That result was not found.",
  failed: "The request did not go out. Try again in a minute.",
};

export default async function TariffResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ emailed?: string; review?: string; raised?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const stored = await loadTariffResponse(db, id);
  if (!stored) notFound();
  const { result } = stored;
  const broker = await reviewBroker(db, stored.partnerSlug, process.env.TARIFF_BROKER_SLUG || null);
  const summaryText = brokerSummary({
    answers: stored.answers,
    result,
    rules: tariffRules,
    preparedOn: todayLabel(),
  });
  const mailto = `mailto:?subject=${encodeURIComponent("IEEPA tariff refund: can you review?")}&body=${encodeURIComponent(summaryText)}`;
  const emailed = query.emailed ? EMAILED[query.emailed] : undefined;
  const review = query.review ? REVIEW[query.review] : undefined;

  return (
    <article className="prose-plain">
      {emailed ? <p className="notice">{emailed}</p> : null}
      <p className="mb-1 text-[0.85rem] font-semibold tracking-[0.09em] text-accent uppercase">
        {result.path.kind === "no-path" ? "Your result" : "Your refund path"}
      </p>
      <h1 className="mt-0 mb-4 text-[2rem] leading-tight font-semibold">{result.path.title}</h1>
      {result.path.summary.map((s) => (
        <p key={s.text}>
          {s.text}
          <Notes notes={s.notes} />
        </p>
      ))}

      {resultSections(result).map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item.text}>
                {item.text}
                <Notes notes={item.notes} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2>Send this to your broker</h2>
        <p>
          Copy it into an email, or <a href={mailto}>open it in your email app</a>.
        </p>
        <pre className="overflow-x-auto rounded bg-[#f3f5f7] p-4 text-[0.85rem] leading-relaxed whitespace-pre-wrap">
          {summaryText}
        </pre>
      </section>

      {broker ? (
        <section id="broker">
          <h2>Ask a broker to review</h2>
          {review ? <p className="notice">{review}</p> : null}
          {query.review !== "sent" ? (
            <form method="post" action="/api/forms/broker-review" className="grid gap-3">
              <input type="hidden" name="responseId" value={stored.id} />
              <p className="m-0">
                {broker.name} can look over your answers and reply to you directly. Nothing is sent
                unless you ask.
              </p>
              <label className="flex items-start gap-2.5">
                <input className="mt-1.5 size-4 shrink-0" type="checkbox" name="consent" value="yes" required />
                <span>Send my summary and email address to {broker.name}.</span>
              </label>
              <div>
                <button type="submit" className="btn">
                  Ask for a review
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      <AssumptionList assumptions={result.assumptions} />

      <section>
        <h2>Sources</h2>
        <ul>
          {result.sources.map((s) => (
            <li key={s.id}>
              {s.text}{" "}
              {s.sources.map((url, i) => (
                <span key={url}>
                  <a href={url} rel="noopener noreferrer" target="_blank">
                    Source{s.sources.length > 1 ? ` ${i + 1}` : ""}
                  </a>{" "}
                </span>
              ))}
              <span className="text-muted">(as of {formatDate(s.asOf)})</span>
            </li>
          ))}
        </ul>
        <p className="text-[0.9rem] text-muted">
          Rules as of {formatDate(result.asOf)}. General information, not legal or customs advice.
          Check your result with your customs broker or a trade attorney.
        </p>
      </section>

      <p>
        <Link href="/tariffrefund/calculator">
          See what imports cost today and on {tariffRules.calculator.futureLabel}
        </Link>
      </p>

      <HandRaise
        tool="tariff"
        prompt="Matching refunds to entries and tracking deadlines is spreadsheet work. Want it wired into your accounting system instead?"
        returnTo={`/tariffrefund/result/${stored.id}`}
        email={stored.email}
        raised={query.raised === "1"}
      />
    </article>
  );
}
