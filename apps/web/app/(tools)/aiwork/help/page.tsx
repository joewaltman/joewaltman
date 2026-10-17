import type { Metadata } from "next";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";
import { AIWORK_HAND_RAISE } from "@/lib/aiwork";

export const metadata: Metadata = { title: "AI tools that stay inside California's rules", robots: { index: false } };

export default async function AiworkHelpPage({ searchParams }: { searchParams: Promise<{ raised?: string }> }) {
  const { raised } = await searchParams;
  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">AI tools that stay inside the rules</h1>
      <p>
        Choosing a screening, scheduling or HR tool is easier when the notices, human review steps and record keeping
        are built in from the start. Joe Waltman builds these setups as fixed-scope projects, usually in about five days.
      </p>
      <HandRaise tool="aiwork" prompt={AIWORK_HAND_RAISE} returnTo="/aiwork/help" raised={raised === "1"} />
      <p className="mt-8">
        <Link href="/aiwork">Back to the AI-at-Work Checker</Link>
      </p>
    </div>
  );
}
