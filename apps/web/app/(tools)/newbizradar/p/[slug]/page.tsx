import { and, eq, getDb, partners } from "@jw/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RadarLanding } from "@/components/radar-landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New Business Radar", robots: { index: false } };

export default async function PartnerRadarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ signup?: string; raised?: string }>;
}) {
  const [{ slug }, { signup, raised }] = await Promise.all([params, searchParams]);
  const [partner] = await getDb()
    .select({ slug: partners.slug, name: partners.name, logoUrl: partners.logoUrl })
    .from(partners)
    .where(and(eq(partners.slug, slug), eq(partners.tool, "radar")))
    .limit(1);
  if (!partner) notFound();
  return <RadarLanding partner={partner} status={signup} raised={raised === "1"} />;
}
