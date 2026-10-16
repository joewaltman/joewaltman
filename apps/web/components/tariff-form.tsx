import type { Question, TariffRules } from "@jw/content";
import { tariffSubmitAction } from "@/app/(tools)/tariffrefund/actions";
import { publicTexts } from "@/lib/tariff-view";

function QuestionField({ q, rules, error }: { q: Question; rules: TariffRules; error?: boolean }) {
  const legend = (
    <legend id={`q-${q.id}-label`} className="mb-2 font-semibold">
      <span className="mr-1 text-muted tabular-nums">{q.number}.</span> {q.label}
      {!q.required ? <span className="font-normal text-muted"> (optional)</span> : null}
    </legend>
  );
  const help = q.help ? <p className="mt-0 mb-2 text-[0.95rem] text-muted">{q.help}</p> : null;
  const explainer = q.explainer ? publicTexts(q.explainer.body, rules) : [];

  return (
    <fieldset
      id={`q-${q.id}`}
      className={`mb-7 border-0 p-0 ${error ? "rounded border-l-4 border-l-red-700 pl-3" : ""}`}
    >
      {legend}
      {help}
      {error ? <p className="mt-0 mb-2 text-[0.95rem] text-red-800">Please answer this one.</p> : null}
      {q.type === "single" || q.type === "multi" ? (
        <div className="grid gap-1.5">
          {q.options!.map((o, i) => (
            <label key={o.value} className="flex items-start gap-2.5">
              <input
                className="mt-1.5 size-4 shrink-0 accent-[#1f4a6b]"
                type={q.type === "single" ? "radio" : "checkbox"}
                name={q.id}
                value={o.value}
                required={q.type === "single" && q.required && i === 0}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <input
          className="field max-w-md"
          type={q.type === "email" ? "email" : "text"}
          name={q.id}
          aria-labelledby={`q-${q.id}-label`}
          required={q.required}
          autoComplete={q.type === "email" ? "email" : "off"}
          maxLength={q.type === "email" ? 254 : 500}
        />
      )}
      {explainer.length > 0 ? (
        <details className="mt-2 text-[0.95rem]">
          <summary className="cursor-pointer text-accent">{q.explainer!.summary}</summary>
          {explainer.map((t) => (
            <p key={t} className="mt-2 mb-0">
              {t}
            </p>
          ))}
        </details>
      ) : null}
    </fieldset>
  );
}

export function TariffForm({
  rules,
  partner,
  errorField,
}: {
  rules: TariffRules;
  partner?: string;
  errorField?: string;
}) {
  return (
    <form action={tariffSubmitAction} className="mt-8">
      {partner ? <input type="hidden" name="partner" value={partner} /> : null}
      {rules.questions.map((q) => (
        <QuestionField key={q.id} q={q} rules={rules} error={errorField === q.id} />
      ))}
      <label className="mb-6 flex items-start gap-2.5">
        <input className="mt-1.5 size-4 shrink-0 accent-[#1f4a6b]" type="checkbox" name="updates" value="yes" />
        <span>Also email me when refund rules or deadlines change. (You will confirm by email first.)</span>
      </label>
      <button type="submit" className="btn">
        Show my refund path
      </button>
      <p className="mt-3 text-[0.9rem] text-muted">
        Your result shows on the next page, and a copy goes to your email.
      </p>
    </form>
  );
}
