import type { Metadata } from "next";
import { AiworkLanding } from "@/components/aiwork-landing";
import { currentAdmin } from "@/lib/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "California AI-at-Work Checker",
  description:
    "Ten questions about your hiring, scheduling and monitoring tools, and a dated list of what California's workplace AI rules ask of you, with notice templates.",
};

export default async function AiworkPage({ searchParams }: { searchParams: Promise<{ error?: string; signup?: string; raised?: string }> }) {
  const { error, signup, raised } = await searchParams;
  return <AiworkLanding errorField={error} isAdmin={Boolean(await currentAdmin())} signup={signup} raised={raised === "1"} />;
}
