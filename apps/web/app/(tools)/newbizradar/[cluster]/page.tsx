import { zipClusters } from "@jw/content";
import { weekLabel } from "@jw/radar";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RadarList, RadarStats, radarCounts } from "@/components/radar-list";
import { lastWeek } from "@/lib/radar-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ cluster: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cluster } = await params;
  const c = Object.hasOwn(zipClusters.clusters, cluster) ? zipClusters.clusters[cluster] : undefined;
  if (!c) return { title: "Not found" };
  return {
    title: `New businesses in ${c.label}`,
    description: `Businesses that opened last week in ${c.label}, San Diego County: new city business tax certificates, state licenses, liquor licenses and contractor licenses.`,
  };
}

export default async function ClusterPage({ params }: { params: Params }) {
  const { cluster } = await params;
  const c = Object.hasOwn(zipClusters.clusters, cluster) ? zipClusters.clusters[cluster] : undefined;
  if (!c) notFound();
  const digest = await lastWeek([cluster]);
  const total = radarCounts(digest).reduce((n, s) => n + s.rows.length, 0);

  return (
    <div>
      <p className="mb-3 text-[0.92rem]">
        <Link href="/newbizradar" className="text-muted no-underline hover:underline">
          ← New Business Radar
        </Link>
      </p>
      <h1 className="mt-0 mb-2 text-[2rem] leading-tight font-semibold">New businesses in {c.label}</h1>
      <p className="mt-0 mb-5 text-muted">
        {weekLabel(digest.start, digest.end)}
        {total > 0 ? ` · ${total} ${total === 1 ? "listing" : "listings"}` : ""}
      </p>

      <nav aria-label="Areas" className="mb-7 flex flex-wrap gap-2">
        {Object.entries(zipClusters.clusters).map(([id, area]) =>
          id === cluster ? (
            <span key={id} aria-current="page" className="rounded-full bg-accent px-3 py-1 text-[0.88rem] font-semibold text-white">
              {area.label}
            </span>
          ) : (
            <Link key={id} href={`/newbizradar/${id}`} className="rounded-full border border-rule bg-white px-3 py-1 text-[0.88rem] text-ink no-underline hover:border-accent">
              {area.label}
            </Link>
          ),
        )}
      </nav>

      <RadarStats digest={digest} />
      <RadarList digest={digest} />

      <div className="mt-10 rounded-md border border-rule bg-[#eef4f9] px-5 py-5" style={{ borderLeft: "4px solid #1f4a6b" }}>
        <p className="mt-0 mb-1.5 text-[1.15rem] font-semibold">Get this list every Monday</p>
        <p className="mt-0 mb-4 text-[0.95rem] text-muted">
          Pick your areas and the kinds of business you sell to. The email adds ZIP codes, sources, a note on each business, websites where we find them, and a CSV.
        </p>
        <Link href="/newbizradar#signup" className="btn no-underline">
          Sign up free
        </Link>
      </div>

      <details className="mt-8 text-[0.92rem] text-muted">
        <summary className="cursor-pointer">ZIP codes in {c.label}</summary>
        <p className="mt-2 mb-0">{c.zips.join(", ")}</p>
      </details>
    </div>
  );
}
