import { zipClusters } from "@jw/content";
import { weekLabel } from "@jw/radar";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RadarList } from "@/components/radar-list";
import { lastWeek } from "@/lib/radar-view";

export const dynamic = "force-dynamic";

type Params = Promise<{ cluster: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cluster } = await params;
  const c = Object.hasOwn(zipClusters.clusters, cluster) ? zipClusters.clusters[cluster] : undefined;
  if (!c) return { title: "Not found" };
  return {
    title: `New businesses in ${c.label}`,
    description: `Businesses that opened last week in ${c.label}, San Diego County: new city business tax certificates, liquor licenses and contractor licenses.`,
  };
}

export default async function ClusterPage({ params }: { params: Params }) {
  const { cluster } = await params;
  const c = Object.hasOwn(zipClusters.clusters, cluster) ? zipClusters.clusters[cluster] : undefined;
  if (!c) notFound();
  const digest = await lastWeek([cluster]);
  return (
    <div className="prose-plain">
      <p className="mb-1 text-[0.95rem]">
        <Link href="/newbizradar">New Business Radar</Link>
      </p>
      <h1 className="mt-0 mb-2 text-[2rem] leading-tight font-semibold">New businesses in {c.label}</h1>
      <p className="text-muted">
        {weekLabel(digest.start, digest.end)}. ZIP codes {c.zips.join(", ")}.
      </p>
      <RadarList digest={digest} />
      <p className="mt-8">
        <Link href="/newbizradar#signup">Get this list by email every Monday</Link>, with ZIP codes,
        sources, a note on each business and a CSV.
      </p>
    </div>
  );
}
