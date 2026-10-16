import type { Tool } from "@jw/db";
import { signupAction } from "@/app/(tools)/actions";

const MESSAGES: Record<string, string> = {
  "check-email":
    "Check your inbox for a confirmation link. Nothing else will arrive until you click it.",
  "already-subscribed": "You are already subscribed.",
  suppressed:
    "This address unsubscribed earlier, so nothing was sent. To come back, email joe@joewaltman.com.",
  "not-open": "Signups are not open yet. Nothing was saved.",
  "send-failed":
    "The confirmation email did not go out. Try again in a minute, or email joe@joewaltman.com.",
  invalid: "That email address does not look right. Try again.",
};

const ROLE_OPTIONS: Array<[string, string]> = [
  ["owner", "Business owner or manager"],
  ["broker", "Customs broker"],
  ["cpa", "CPA or bookkeeper"],
  ["banker", "Banker or lender"],
  ["insurance", "Insurance agent"],
  ["payroll", "Payroll or merchant services"],
  ["cre", "Commercial real estate"],
  ["attorney", "Attorney"],
  ["hr", "HR consultant or PEO"],
  ["other", "Something else"],
];

export function SignupForm({
  tool,
  returnTo,
  status,
  partner,
  buttonLabel = "Sign up",
}: {
  tool: Tool;
  returnTo: string;
  status?: string;
  partner?: string;
  buttonLabel?: string;
}) {
  const message = status ? MESSAGES[status] : undefined;
  return (
    <form id="signup" action={signupAction} className="grid max-w-md gap-3">
      {message ? <p className="notice">{message}</p> : null}
      <input type="hidden" name="tool" value={tool} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {partner ? <input type="hidden" name="partner" value={partner} /> : null}
      <label className="grid gap-1">
        <span className="text-[0.95rem] font-semibold">Email</span>
        <input className="field" type="email" name="email" required autoComplete="email" />
      </label>
      <label className="grid gap-1">
        <span className="text-[0.95rem] font-semibold">
          Name <span className="font-normal text-muted">(optional)</span>
        </span>
        <input className="field" type="text" name="name" autoComplete="name" />
      </label>
      <label className="grid gap-1">
        <span className="text-[0.95rem] font-semibold">
          What best describes you? <span className="font-normal text-muted">(optional)</span>
        </span>
        <select className="field" name="role" defaultValue="">
          <option value="">Choose one</option>
          {ROLE_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="submit" className="btn">
          {buttonLabel}
        </button>
      </div>
      <p className="text-[0.9rem] text-muted">
        You will get one email to confirm. Unsubscribe any time with one click.
      </p>
    </form>
  );
}
