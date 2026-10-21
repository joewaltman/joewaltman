import { type AiworkObligation, formatLongDate, obligationGroups } from "@jw/content";
import { and, eq, getDb, partners } from "@jw/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssumptionList, Notes } from "@/components/assumptions";
import { HandRaise } from "@/components/hand-raise";
import { AIWORK_HAND_RAISE, loadAiworkResponse, standingLine } from "@/lib/aiwork";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your AI-at-Work checklist", robots: { index: false } };

const ACTION_LABELS: Record<string, string> = {
  notice: "Notice",
  records: "Records",
  human: "Human review",
  vendor: "Vendor",
  assessment: "Assessment",
  stop: "Stop",
};

const EMAIL_MESSAGES: Record<string, string> = {
  sent: "A copy is on its way to your email.",
  dryrun: "A copy was written to a file (email is in test mode).",
  failed: "The email copy did not go out. This page has everything.",
};

function ObligationCard({ o, preview }: { o: AiworkObligation; preview: boolean }) {
  return (
    <section className="mb-7">
      <h3 className="mb-1 text-[1.15rem] font-semibold">
        {o.title}
        <Notes notes={o.notes} />
      </h3>
      {o.law ? <p className="mt-0 mb-2 text-[0.9rem] text-muted">{o.law.name}</p> : null}
      {o.checkFirst ? <p className="notice">{o.checkFirst}</p> : null}
      {o.summary.map((s) => (
        <p key={s.text} className="mt-0">
          {s.text}
          <Notes notes={s.notes} />
        </p>
      ))}
      <ul className="mt-0 grid gap-1.5 pl-5">
        {o.actions.map((a) => (
          <li key={a.text.text}>
            <span className="font-semibold">{ACTION_LABELS[a.kind]}:</span> {a.text.text}
            <Notes notes={a.text.notes} />
          </li>
        ))}
      </ul>
      {o.templates.length > 0 ? (
        <p className="mb-0 text-[0.95rem]">
          Template{o.templates.length > 1 ? "s" : ""}:{" "}
          {o.templates.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? ", " : ""}
              <a href={`/aiwork/templates/${t.id}`}>{t.title}</a>
            </span>
          ))}
        </p>
      ) : null}
      {preview && o.unverified.length > 0 ? <p className="text-[0.85rem] text-muted">Awaiting attorney review: {o.unverified.join(", ")}</p> : null}
    </section>
  );
}

export default async function AiworkResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ emailed?: string; raised?: string }> }) {
  const [{ id }, { emailed, raised }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = getDb();
  const stored = await loadAiworkResponse(db, id);
  if (!stored) notFound();
  const { result, preview } = stored;
  const [partner] = stored.partnerSlug
    ? await db
        .select({ name: partners.name, bookingUrl: partners.bookingUrl, contactEmail: partners.contactEmail })
        .from(partners)
        .where(and(eq(partners.slug, stored.partnerSlug), eq(partners.tool, "aiwork")))
        .limit(1)
    : [];
  const groups = obligationGroups(result, new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(stored.createdAt));
  const bookHref = partner?.bookingUrl ?? (partner?.contactEmail ? `mailto:${partner.contactEmail}` : null);

  return (
    <div className="prose-plain">
      <p className="notice">{standingLine(result, preview)}</p>
      <h1 className="mb-2 text-[2rem] leading-tight font-semibold">Your AI-at-Work checklist</h1>
      {emailed && EMAIL_MESSAGES[emailed] ? <p className="text-muted">{EMAIL_MESSAGES[emailed]}</p> : null}
      {partner && bookHref ? (
        <p>
          <a className="btn no-underline" href={bookHref}>
            Book a review with {partner.name}
          </a>
        </p>
      ) : null}
      {groups.length === 0 ? <p>Nothing in your answers triggers these rules today. Check again if you add AI screening, scheduling or monitoring tools.</p> : null}
      {groups.map((g) => (
        <div key={g.heading}>
          <h2>{g.heading}</h2>
          {g.items.map((o) => (
            <ObligationCard key={o.id} o={o} preview={preview} />
          ))}
        </div>
      ))}
      {result.vendors ? (
        <div>
          <h2>Check your hiring software</h2>
          {result.vendors.answeredNo ? <p className="notice">{result.vendors.answeredNo}</p> : null}
          {result.vendors.intro.map((l) => (
            <p key={l.text} className="mt-0 text-[0.95rem] text-muted">
              {l.text}
              <Notes notes={l.notes} />
            </p>
          ))}
          {result.vendors.systems.map((v) => (
            <section key={v.id} className="mb-6">
              <h3 className="mb-1 text-[1.1rem] font-semibold">{v.name}</h3>
              <ul className="mt-0 grid gap-1.5 pl-5">
                {v.lines.map((l) => (
                  <li key={l.text}>
                    {l.text}
                    <Notes notes={l.notes} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {result.notTriggered.length > 0 ? (
        <>
          <h2>Also checked</h2>
          <p>Nothing in your answers triggers: {result.notTriggered.map((l) => l.name).join("; ")}.</p>
        </>
      ) : null}
      {result.hidden.length > 0 && !preview ? (
        <p className="text-[0.95rem] text-muted">Some rules are still being confirmed and are not shown yet.</p>
      ) : null}
      <AssumptionList assumptions={result.assumptions} />
      <h2>Sources</h2>
      <ul className="text-[0.95rem]">
        {result.sources.map((s) => (
          <li key={s.id}>
            {s.text} <span className="text-muted">As of {formatLongDate(s.asOf)}.</span>{" "}
            {s.sources.map((u) => (
              <a key={u} href={u} rel="noopener noreferrer" target="_blank" className="mr-2">
                {new URL(u).hostname.replace(/^www\./, "")}
              </a>
            ))}
            {preview && s.verify ? <strong> (awaiting review)</strong> : null}
          </li>
        ))}
      </ul>
      <p className="text-[0.9rem] text-muted">Rules as of {formatLongDate(result.asOf)}, version {result.rulesVersion}.</p>
      <HandRaise tool="aiwork" prompt={AIWORK_HAND_RAISE} returnTo={`/aiwork/result/${id}`} raised={raised === "1"} />
      <p className="mt-8">
        <Link href="/aiwork">Start over</Link>
      </p>
    </div>
  );
}
