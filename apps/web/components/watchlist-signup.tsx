import { SIGNUP_MESSAGES } from "@/components/signup-form";
import { AR_BANDS, INDUSTRIES, REVENUE_BANDS, WATCH_ROLES } from "@/lib/watch-view";

function Choice({ name, label, options, required }: { name: string; label: string; options: Array<[string, string]>; required?: boolean }) {
  return (
    <label className="grid gap-1">
      <span className="font-semibold">
        {label} {required ? null : <span className="font-normal text-muted">(optional)</span>}
      </span>
      <select className="field" name={name} defaultValue="" required={required}>
        <option value="" disabled={required}>
          Choose one
        </option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WatchlistSignup({ returnTo, status, partner }: { returnTo: string; status?: string; partner?: string }) {
  const message =
    status === "check-email"
      ? "Check your inbox. The link in that email confirms your address and opens your list, where you add customers."
      : status
        ? SIGNUP_MESSAGES[status]
        : undefined;
  return (
    <form id="signup" method="post" action="/api/forms/watchlist-signup" className="grid max-w-xl gap-3">
      {message ? <p className="notice">{message}</p> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      {partner ? <input type="hidden" name="partner" value={partner} /> : null}
      <label className="grid gap-1">
        <span className="font-semibold">Email</span>
        <input className="field" type="email" name="email" required autoComplete="email" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="font-semibold">Company</span>
          <input className="field" type="text" name="company" required autoComplete="organization" maxLength={200} />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">
            Name <span className="font-normal text-muted">(optional)</span>
          </span>
          <input className="field" type="text" name="name" autoComplete="name" maxLength={200} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Choice name="role" label="Your role" options={WATCH_ROLES} required />
        <Choice name="industry" label="Your industry" options={INDUSTRIES} required />
        <Choice name="revenue" label="Annual revenue" options={REVENUE_BANDS} />
        <Choice name="ar" label="Typical receivables outstanding" options={AR_BANDS} />
      </div>
      <div>
        <button type="submit" className="btn">
          Start my watchlist
        </button>
        <p className="mt-2 mb-0 text-[0.9rem] text-muted">
          Free. One email to confirm, then you add customers. Weekly email on Monday mornings; unsubscribe any time with one click.
        </p>
      </div>
    </form>
  );
}
