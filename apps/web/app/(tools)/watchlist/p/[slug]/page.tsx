import { and, eq, getDb, partners } from "@jw/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WatchlistLanding } from "@/components/watchlist-landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Customer Watchlist", robots: { index: false } };

export default async function PartnerWatchlistPage({
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
    .where(and(eq(partners.slug, slug), eq(partners.tool, "watchlist")))
    .limit(1);
  if (!partner) notFound();
  return <WatchlistLanding partner={partner} status={signup} raised={raised === "1"} />;
}
