import { answerLabel, evaluateTariff, tariffRules, unverifiedFacts } from "@jw/content";
import {
  and,
  desc,
  eq,
  events,
  getDb,
  prerunNotes,
  questionnaireResponses,
  subscribers,
} from "@jw/db";
import { DataTable, formatCell } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";
import { formatDate } from "@/lib/tariff-view";
import { prerunNoteAction } from "../../actions";

// Which public copy each unverified fact is holding back, across every path and action.
function hiddenUses(): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const add = (factIds: string[], where: string) => {
    for (const f of factIds) uses.set(f, [...(uses.get(f) ?? []), where]);
  };
  for (const pathId of Object.keys(tariffRules.paths)) {
    const r = evaluateTariff({}, { ...tariffRules, rules: [], fallbackPath: pathId }, "admin");
    for (const h of r.hidden) add(h.verifyFacts, h.where);
  }
  for (const a of tariffRules.actions) {
    for (const item of a.body) if (typeof item !== "string") add(item.facts.filter((f) => tariffRules.facts[f]?.verify), `action ${a.id}`);
  }
  for (const q of tariffRules.questions) {
    for (const item of q.explainer?.body ?? []) if (typeof item !== "string") add(item.facts.filter((f) => tariffRules.facts[f]?.verify), `question ${q.number}`);
  }
  const c = tariffRules.calculator;
  for (const x of [...c.categories, ...c.countries]) {
    for (const item of x.notes) if (typeof item !== "string") add(item.facts.filter((f) => tariffRules.facts[f]?.verify), `calculator ${x.id}`);
  }
  add([c.s301.exemptionsFact, c.s301.netOfMfnFact, ...c.mpfMinimum.facts, ...c.brokerFee.facts].filter((f) => tariffRules.facts[f]?.verify), "calculator");
  return uses;
}

export default async function AdminTariffPage() {
  await requireAdmin();
  const db = getDb();
  const [responses, reviews, notes] = await Promise.all([
    db
      .select({
        id: questionnaireResponses.id,
        createdAt: questionnaireResponses.createdAt,
        email: subscribers.email,
        answers: questionnaireResponses.answers,
        result: questionnaireResponses.result,
        rulesVersion: questionnaireResponses.rulesVersion,
      })
      .from(questionnaireResponses)
      .leftJoin(subscribers, eq(questionnaireResponses.subscriberId, subscribers.id))
      .where(eq(questionnaireResponses.tool, "tariff"))
      .orderBy(desc(questionnaireResponses.createdAt))
      .limit(200),
    db
      .select()
      .from(events)
      .where(and(eq(events.tool, "tariff"), eq(events.type, "broker_review")))
      .orderBy(desc(events.createdAt))
      .limit(100),
    db
      .select()
      .from(prerunNotes)
      .where(eq(prerunNotes.tool, "tariff"))
      .orderBy(desc(prerunNotes.createdAt))
      .limit(200),
  ]);
  const verify = unverifiedFacts(tariffRules);
  const assumed = Object.entries(tariffRules.facts)
    .filter(([, f]) => f.assumption && !f.verify)
    .map(([id, f]) => ({ id, ...f }));
  const uses = hiddenUses();

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">Tariff Refund Tool</h1>
      <p className="mb-8 text-muted">
        Rules version {tariffRules.version}, as of {formatDate(tariffRules.asOf)}. Edit{" "}
        <code>content/tariff-rules.json</code> and redeploy to change them.
      </p>

      <h2 className="mb-2 text-[1.2rem] font-semibold">Assumptions in use ({assumed.length})</h2>
      <p className="mb-4 text-[0.95rem] text-muted">
        Judgment calls made without broker review. Visitors see each one as a numbered footnote on
        the result and calculator pages. Change or remove one in <code>content/tariff-rules.json</code>.
      </p>
      <ol className="mb-10 grid list-decimal gap-4 pl-5 text-[0.95rem]">
        {assumed.map((f) => (
          <li key={f.id}>
            <strong>{f.id}</strong>: {f.assumption}
            <div className="text-muted">
              Sources:{" "}
              {f.sources.map((u) => (
                <a key={u} href={u} className="mr-2" rel="noopener noreferrer" target="_blank">
                  {new URL(u).hostname}
                </a>
              ))}
            </div>
            {f.note ? <div className="text-muted">{f.note}</div> : null}
          </li>
        ))}
      </ol>

      {verify.length > 0 ? (
        <>
          <h2 className="mb-2 text-[1.2rem] font-semibold">Unconfirmed, hidden from visitors ({verify.length})</h2>
          <ol className="mb-10 grid list-decimal gap-4 pl-5 text-[0.95rem]">
            {verify.map((f) => (
              <li key={f.id}>
                <strong>{f.id}</strong>: {f.text}
                {f.note ? <div className="text-muted">{f.note}</div> : null}
                <div className="text-muted">Holding back: {uses.get(f.id)?.join(", ") ?? "not used in copy yet"}</div>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <h2 className="mb-3 text-[1.2rem] font-semibold">Recent results</h2>
      <DataTable
        rows={responses.map((r) => {
          const result = r.result as { pathId?: string };
          const answers = r.answers as Record<string, string | string[]>;
          return {
            id: r.id,
            createdAt: r.createdAt,
            email: r.email ?? "",
            path: result.pathId ?? "",
            duty: answerLabel(tariffRules, "dutyBand", answers.dutyBand),
            importValue: answerLabel(tariffRules, "importValue", answers.importValue),
            brokers: answers.brokers ?? "",
            partner: answers.partnerSlug ?? "",
          };
        })}
        empty="No results yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "email", label: "Email" },
          {
            key: "path",
            label: "Path",
            render: (r) => <a href={`/tariffrefund/result/${String(r.id)}`}>{String(r.path)}</a>,
          },
          { key: "duty", label: "IEEPA duty" },
          { key: "importValue", label: "Imports a year" },
          { key: "brokers", label: "Brokers" },
          { key: "partner", label: "Partner" },
        ]}
      />

      <h2 className="mt-10 mb-3 text-[1.2rem] font-semibold">Broker review requests</h2>
      <DataTable
        rows={reviews.map((e) => ({ id: e.id, createdAt: e.createdAt, meta: formatCell(e.meta) }))}
        empty="No review requests yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "meta", label: "Details" },
        ]}
      />

      <h2 className="mt-10 mb-2 text-[1.2rem] font-semibold">Pre-run helper</h2>
      <p className="mb-3 text-[0.95rem] text-muted">
        Paste an importer name to get an ImportYeti search link and keep a note. Links only; nothing
        is fetched automatically.
      </p>
      <form action={prerunNoteAction} className="mb-6 grid max-w-md gap-3">
        <input type="hidden" name="tool" value="tariff" />
        <input type="hidden" name="returnTo" value="/admin/tariff" />
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Importer name</span>
          <input className="field" name="subject" required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Note</span>
          <textarea className="field" name="note" rows={2} />
        </label>
        <div>
          <button type="submit" className="btn">
            Save and get link
          </button>
        </div>
      </form>
      <DataTable
        rows={notes}
        empty="No notes yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "subject", label: "Importer" },
          {
            key: "url",
            label: "ImportYeti",
            render: (r) =>
              r.url ? (
                <a href={String(r.url)} rel="noopener noreferrer" target="_blank">
                  Search
                </a>
              ) : (
                ""
              ),
          },
          { key: "note", label: "Note" },
        ]}
      />
    </div>
  );
}
