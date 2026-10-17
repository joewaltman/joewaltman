import { and, eq, getDb, partners } from "@jw/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AiworkLanding } from "@/components/aiwork-landing";
import { currentAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "California AI-at-Work Checker", robots: { index: false } };

export default async function PartnerAiworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; signup?: string; raised?: string }>;
}) {
  const [{ slug }, { error, signup, raised }] = await Promise.all([params, searchParams]);
  const [partner] = await getDb()
    .select({ slug: partners.slug, name: partners.name, logoUrl: partners.logoUrl })
    .from(partners)
    .where(and(eq(partners.slug, slug), eq(partners.tool, "aiwork")))
    .limit(1);
  if (!partner) notFound();
  return <AiworkLanding partner={partner} errorField={error} isAdmin={Boolean(await currentAdmin())} signup={signup} raised={raised === "1"} />;
}
