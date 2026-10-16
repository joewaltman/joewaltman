import type { Metadata } from "next";
import { RadarLanding } from "@/components/radar-landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New Business Radar",
  description:
    "A free weekly list of businesses that just opened in San Diego County, from city business tax certificates, ABC liquor licenses and CSLB contractor licenses.",
};

export default async function NewBizRadarPage({
  searchParams,
}: {
  searchParams: Promise<{ signup?: string; raised?: string }>;
}) {
  const { signup, raised } = await searchParams;
  return <RadarLanding status={signup} raised={raised === "1"} />;
}
