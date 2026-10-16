import { and, eq, getDb, partners } from "@jw/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TariffLanding } from "@/components/tariff-landing";

export const metadata: Metadata = {
  title: "Tariff Refund Tool",
  robots: { index: false },
};

export default async function PartnerTariffPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ slug }, { error }] = await Promise.all([params, searchParams]);
  const [partner] = await getDb()
    .select({ slug: partners.slug, name: partners.name, logoUrl: partners.logoUrl })
    .from(partners)
    .where(and(eq(partners.slug, slug), eq(partners.tool, "tariff")))
    .limit(1);
  if (!partner) notFound();
  return <TariffLanding partner={partner} errorField={error} />;
}
