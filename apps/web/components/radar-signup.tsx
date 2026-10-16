import { taxonomy, zipClusters } from "@jw/content";
import { ROLE_OPTIONS, SIGNUP_MESSAGES } from "@/components/signup-form";
import { CLIENT_BANDS } from "@/lib/radar-view";

const box = "mt-1.5 size-4 shrink-0 accent-[#1f4a6b]";

export function RadarSignup({
  returnTo,
  status,
  partner,
}: {
  returnTo: string;
  status?: string;
  partner?: string;
}) {
  const message =
    status === "no-area" ? "Pick at least one area." : status ? SIGNUP_MESSAGES[status] : undefined;
  return (
    <form id="signup" method="post" action="/api/forms/radar-signup" className="grid max-w-xl gap-5">
      {message ? <p className="notice">{message}</p> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      {partner ? <input type="hidden" name="partner" value={partner} /> : null}

      <fieldset className="border-0 p-0">
        <legend className="mb-2 font-semibold">Which areas?</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {Object.entries(zipClusters.clusters).map(([id, c]) => (
            <label key={id} className="flex items-start gap-2.5">
              <input className={box} type="checkbox" name="clusters" value={id} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="border-0 p-0">
        <legend className="mb-1 font-semibold">Which kinds of business?</legend>
        <p className="mt-0 mb-2 text-[0.95rem] text-muted">Leave all unchecked to get every kind.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {taxonomy.categories.map((c) => (
            <label key={c.id} className="flex items-start gap-2.5 text-[0.95rem]">
              <input className={box} type="checkbox" name="categories" value={c.id} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3">
        <label className="grid gap-1">
          <span className="font-semibold">Email</span>
          <input className="field" type="email" name="email" required autoComplete="email" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="font-semibold">
              Name <span className="font-normal text-muted">(optional)</span>
            </span>
            <input className="field" type="text" name="name" autoComplete="name" />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold">
              Company <span className="font-normal text-muted">(optional)</span>
            </span>
            <input className="field" type="text" name="company" autoComplete="organization" />
          </label>
        </div>
        <label className="grid gap-1">
          <span className="font-semibold">What best describes you?</span>
          <select className="field" name="role" defaultValue="" required>
            <option value="" disabled>
              Choose one
            </option>
            {ROLE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">
            What do you sell to new businesses? <span className="font-normal text-muted">(optional)</span>
          </span>
          <input className="field" type="text" name="sells" maxLength={200} />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">
            How many clients do you serve? <span className="font-normal text-muted">(optional)</span>
          </span>
          <select className="field" name="clients" defaultValue="">
            <option value="">Choose one</option>
            {CLIENT_BANDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <button type="submit" className="btn">
          Send me the weekly list
        </button>
        <p className="mt-2 mb-0 text-[0.9rem] text-muted">
          Weekly, Monday mornings. One email to confirm first; unsubscribe any time with one click.
        </p>
      </div>
    </form>
  );
}
