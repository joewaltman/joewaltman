import { WATCH_EVENTS } from "@jw/pipeline/watchlist";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";
import { WatchlistSignup } from "@/components/watchlist-signup";

export const ERP_PROMPT = "Want credit holds and collections sequences wired into your ERP or QuickBooks?";

const SOURCES: Array<[string, string]> = [
  ["Federal courts (CourtListener)", "https://www.courtlistener.com/"],
  ["CSLB", "https://www.cslb.ca.gov/"],
  ["California ABC", "https://www.abc.ca.gov/"],
  ["City of San Diego", "https://data.sandiego.gov/datasets/business-listings/"],
];

export function WatchlistLanding({
  partner,
  status,
  raised,
}: {
  partner?: { slug: string; name: string; logoUrl: string | null } | null;
  status?: string;
  raised?: boolean;
}) {
  const base = partner ? `/watchlist/p/${partner.slug}` : "/watchlist";
  const bySource = new Map<string, string[]>();
  for (const e of Object.values(WATCH_EVENTS)) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e.label.toLowerCase()]);
  return (
    <div className="prose-plain">
      {partner ? (
        <p className="notice flex items-center gap-3">
          {partner.logoUrl ? <img src={partner.logoUrl} alt="" className="h-8 w-auto" /> : null}
          <span>Shared with you by {partner.name}.</span>
        </p>
      ) : null}
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">Customer Watchlist</h1>
      <p className="text-[1.1rem] text-muted">
        Add up to 25 customers you sell to on terms. Every Monday you get an email listing any new public records on
        them, each linked to the record itself.
      </p>
      <p>
        Built for owners, controllers and credit managers at distributors, manufacturers, subcontractors and staffing
        firms.
      </p>

      <h2>What it watches</h2>
      <ul>
        {SOURCES.map(([source, url]) => (
          <li key={source}>
            <a href={url} rel="noopener noreferrer" target="_blank">
              {source}
            </a>
            : {bySource.get(source)?.join("; ")}.
          </li>
        ))}
      </ul>
      <p className="text-[0.95rem] text-muted">
        Court records cover every federal court. License and city records cover San Diego County for now.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>Paste your customer names or upload a CSV. City and state help but are optional.</li>
        <li>
          Confirm the matches. Each one shows its address and the license or account numbers behind it. Names with no
          match are still watched in court records.
        </li>
        <li>Read the Monday email. A quiet week is two lines.</li>
      </ol>

      <h2>What it does not do</h2>
      <p>
        It reports dated public records about businesses. It never looks up people, and it does not score or rate
        anyone. Court searches run only for registered entities (LLCs, corporations, partnerships), so a sole
        proprietor&apos;s personal filings never appear.
      </p>

      <h2>Start a watchlist</h2>
      <WatchlistSignup returnTo={base} status={status} partner={partner?.slug} />
      <p className="mt-6">
        Already have one? <Link href="/watchlist/sign-in">Sign in</Link>.
      </p>

      <HandRaise tool="watchlist" prompt={ERP_PROMPT} returnTo={base} raised={raised} />
    </div>
  );
}
