import { zipClusters } from "@jw/content";
import { weekLabel } from "@jw/radar";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";
import { RadarList } from "@/components/radar-list";
import { RadarSignup } from "@/components/radar-signup";
import { lastWeek } from "@/lib/radar-view";

const SAMPLE_CLUSTER = "north-county-coastal";

export async function RadarLanding({
  partner,
  status,
  raised,
}: {
  partner?: { slug: string; name: string; logoUrl: string | null } | null;
  status?: string;
  raised?: boolean;
}) {
  const sample = await lastWeek([SAMPLE_CLUSTER]);
  const base = partner ? `/newbizradar/p/${partner.slug}` : "/newbizradar";
  return (
    <div className="prose-plain">
      {partner ? (
        <p className="notice flex items-center gap-3">
          {/* Partner logos are small external images Joe sets in admin, so a plain img is enough. */}
          {partner.logoUrl ? <img src={partner.logoUrl} alt="" className="h-8 w-auto" /> : null}
          <span>Shared with you by {partner.name}.</span>
        </p>
      ) : null}
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">New Business Radar</h1>
      <p className="text-[1.1rem] text-muted">
        Every Monday, a list of businesses that just opened in the San Diego County areas you pick,
        drawn from city business tax certificates, liquor license filings and contractor licenses.
      </p>
      <p>
        Built for people who sell to new businesses: CPAs, bankers, insurance agents, payroll and
        merchant services reps, printers and sign shops, IT providers, and commercial real estate
        brokers.
      </p>

      <h2>Last week in {zipClusters.clusters[SAMPLE_CLUSTER]!.label}</h2>
      <p className="text-[0.95rem] text-muted">
        {weekLabel(sample.start, sample.end)}. The emailed list adds the legal name, ZIP code, the
        sources, the date first seen and a one-line note for each business, plus a CSV.
      </p>
      <RadarList digest={sample} limit={8} />

      <h2>Every area</h2>
      <ul>
        {Object.entries(zipClusters.clusters).map(([id, c]) => (
          <li key={id}>
            <Link href={`/newbizradar/${id}`}>{c.label}</Link>
          </li>
        ))}
      </ul>

      <h2>Get the list every Monday</h2>
      <RadarSignup returnTo={base} status={status} partner={partner?.slug} />

      <HandRaise
        tool="radar"
        prompt="Want this piped into your CRM with enrichment and follow-up sequences?"
        returnTo={base}
        raised={raised}
      />
    </div>
  );
}
