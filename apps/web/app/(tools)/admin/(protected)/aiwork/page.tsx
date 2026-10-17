import { aiworkRules, formatLongDate } from "@jw/content";
import { and, desc, eq, getDb, prerunNotes, questionnaireResponses, subscribers } from "@jw/db";
import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { aiworkOpen } from "@/lib/aiwork";
import { requireAdmin } from "@/lib/server";

export default async function AdminAiworkPage({ searchParams }: { searchParams: Promise<{ ats?: string }> }) {
  await requireAdmin();
  const { ats } = await searchParams;
  const db = getDb();
  const [responses, notes] = await Promise.all([
    db
      .select({ id: questionnaireResponses.id, createdAt: questionnaireResponses.createdAt, email: subscribers.email, answers: questionnaireResponses.answers, result: questionnaireResponses.result })
      .from(questionnaireResponses)
      .leftJoin(subscribers, eq(questionnaireResponses.subscriberId, subscribers.id))
      .where(eq(questionnaireResponses.tool, "aiwork"))
      .orderBy(desc(questionnaireResponses.createdAt))
      .limit(200),
    db.select().from(prerunNotes).where(and(eq(prerunNotes.tool, "aiwork"))).orderBy(desc(prerunNotes.createdAt)).limit(200),
  ]);
  const open = aiworkOpen(aiworkRules);
  const pending = Object.entries(aiworkRules.facts).filter(([, f]) => f.verify);

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">AI-at-Work Checker</h1>
      <p className="mb-2 text-muted">
        Rules version {aiworkRules.version}, as of {formatLongDate(aiworkRules.asOf)}.{" "}
        {open ? `Open to visitors; reviewed by ${aiworkRules.review.reviewedBy} on ${formatLongDate(aiworkRules.review.reviewedOn!)}.` : "Closed to visitors until an attorney's review is recorded. You can run it as a preview at /aiwork."}
      </p>
      <p className="mb-8">
        <a href="/admin/aiwork/packet">Download the review packet for the attorney</a> (plain text: questions, every statement with sources, every obligation with its triggers, and the templates). <Link href="/aiwork">Open the checker</Link>.
      </p>

      <h2 className="mb-2 text-[1.2rem] font-semibold">Awaiting attorney review ({pending.length})</h2>
      <p className="mb-4 text-[0.95rem] text-muted">
        After review: set <code>verify</code> to false on each confirmed statement (correcting its text if needed), fill in <code>review.reviewedBy</code> and <code>review.reviewedOn</code> in <code>content/aiwork-rules.json</code>, and deploy.
      </p>
      <ol className="mb-10 grid list-decimal gap-3 pl-5 text-[0.95rem]">
        {pending.map(([id, f]) => (
          <li key={id}>
            <strong>{id}</strong>: {f.text}
            {f.note ? <div className="text-muted">{f.note}</div> : null}
          </li>
        ))}
      </ol>

      <h2 className="mb-3 text-[1.2rem] font-semibold">Recent results</h2>
      <DataTable
        rows={responses.map((r) => {
          const a = r.answers as Record<string, unknown>;
          const res = r.result as { obligations?: Array<{ id: string }> };
          return { id: r.id, createdAt: r.createdAt, email: r.email ?? "", employees: String(a.employees ?? ""), obligations: (res.obligations ?? []).map((o) => o.id).join(", "), preview: a.preview ? "preview" : "", partner: String(a.partnerSlug ?? "") };
        })}
        empty="No results yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "email", label: "Email" },
          { key: "employees", label: "Employees" },
          { key: "obligations", label: "Obligations", render: (r) => <a href={`/aiwork/result/${String(r.id)}`}>{String(r.obligations) || "none"}</a> },
          { key: "preview", label: "" },
          { key: "partner", label: "Partner" },
        ]}
      />

      <h2 id="prerun" className="mt-10 mb-2 text-[1.2rem] font-semibold">Pre-run helper</h2>
      <p className="mb-3 text-[0.95rem] text-muted">Paste a company's careers page. The applicant tracking system is read from the URL and the page, and saved with your note for outreach.</p>
      {ats === "bad-url" ? <p className="notice">That does not look like a public web address.</p> : null}
      <form method="post" action="/api/forms/admin-aiwork-ats" className="mb-6 grid max-w-md gap-3">
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Careers page URL</span>
          <input className="field" name="url" type="url" required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Company (optional)</span>
          <input className="field" name="company" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Note</span>
          <textarea className="field" name="note" rows={2} />
        </label>
        <div>
          <button type="submit" className="btn">
            Check and save
          </button>
        </div>
      </form>
      <DataTable
        rows={notes}
        empty="No notes yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "subject", label: "Company" },
          { key: "url", label: "Careers page", render: (r) => (r.url ? <a href={String(r.url)} rel="noopener noreferrer" target="_blank">{new URL(String(r.url)).hostname}</a> : "") },
          { key: "note", label: "Note" },
        ]}
      />
    </div>
  );
}
