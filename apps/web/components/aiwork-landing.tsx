import { aiworkRules, formatLongDate } from "@jw/content";
import { HandRaise } from "@/components/hand-raise";
import { SignupForm } from "@/components/signup-form";
import { QuestionField } from "@/components/tariff-form";
import { AIWORK_HAND_RAISE, aiworkOpen } from "@/lib/aiwork";

export function AiworkLanding({
  partner,
  errorField,
  isAdmin,
  signup,
  raised,
}: {
  partner?: { slug: string; name: string; logoUrl: string | null } | null;
  errorField?: string;
  isAdmin: boolean;
  signup?: string;
  raised?: boolean;
}) {
  const open = aiworkOpen(aiworkRules);
  const base = partner ? `/aiwork/p/${partner.slug}` : "/aiwork";
  return (
    <div className="prose-plain">
      {partner ? (
        <p className="notice flex items-center gap-3">
          {partner.logoUrl ? <img src={partner.logoUrl} alt="" className="h-8 w-auto" /> : null}
          <span>Shared with you by {partner.name}.</span>
        </p>
      ) : null}
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">California AI-at-Work Checker</h1>
      <p className="text-[1.1rem] text-muted">
        Ten questions about the hiring, scheduling and monitoring tools you use. The result is a dated list of what
        California's rules on AI in the workplace ask of you, what to do about each, and notice templates.
      </p>
      <p>For owners and managers of California employers with five or more employees.</p>
      {open && aiworkRules.review.reviewedBy ? (
        <p className="text-[0.95rem] text-muted">
          An information tool, not legal advice. Reviewed by {aiworkRules.review.reviewedBy} as of{" "}
          {formatLongDate(aiworkRules.review.reviewedOn!)}. Rules as of {formatLongDate(aiworkRules.asOf)}.
        </p>
      ) : open ? (
        <p className="text-[0.95rem] text-muted">
          An information tool, not legal advice, and not reviewed by an attorney. It is built from the regulations
          and law firm summaries cited on your result, and footnotes every assumption it makes. Rules as of{" "}
          {formatLongDate(aiworkRules.asOf)}.
        </p>
      ) : (
        <>
          <p>
            The checker opens once an employment attorney has reviewed its rules. Leave your email and you will get
            one note when it does.
          </p>
          <SignupForm tool="aiwork" returnTo={base} status={signup} partner={partner?.slug} buttonLabel="Tell me when it opens" />
        </>
      )}

      {open || isAdmin ? (
        <form method="post" action="/api/forms/aiwork-submit" className="mt-8">
          {!open ? <p className="notice">Admin preview. Visitors see the signup above until the attorney review is recorded in content/aiwork-rules.json.</p> : null}
          {errorField ? <p className="notice">One answer was missing or not valid. It is marked below.</p> : null}
          {partner ? <input type="hidden" name="partner" value={partner.slug} /> : null}
          {aiworkRules.questions.map((q) => (
            <QuestionField key={q.id} q={q} error={errorField === q.id} />
          ))}
          <label className="mb-6 flex items-start gap-2.5">
            <input className="mt-1.5 size-4 shrink-0 accent-[#1f4a6b]" type="checkbox" name="updates" value="yes" />
            <span>Also email me when these rules or dates change. (You will confirm by email first.)</span>
          </label>
          <button type="submit" className="btn">
            Show my checklist
          </button>
        </form>
      ) : null}

      <HandRaise tool="aiwork" prompt={AIWORK_HAND_RAISE} returnTo={base} raised={raised} />
    </div>
  );
}
