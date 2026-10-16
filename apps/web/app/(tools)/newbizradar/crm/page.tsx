import type { Metadata } from "next";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";

export const metadata: Metadata = { title: "New Business Radar in your CRM", robots: { index: false } };

// Where the digest's "click here" lands: one button, no account needed.
export default async function RadarCrmPage({ searchParams }: { searchParams: Promise<{ raised?: string }> }) {
  const { raised } = await searchParams;
  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">The Radar, wired into your CRM</h1>
      <p>
        Instead of reading the list each Monday, new businesses in your areas can land in your CRM
        as leads, with website, phone and owner-type enrichment, and a follow-up sequence that
        starts on its own.
      </p>
      <p>
        Joe Waltman builds this kind of setup as a fixed-scope project, usually in about five days.
      </p>
      <HandRaise
        tool="radar"
        prompt="Want this piped into your CRM with enrichment and follow-up sequences?"
        returnTo="/newbizradar/crm"
        raised={raised === "1"}
      />
      <p className="mt-8">
        <Link href="/newbizradar">Back to the New Business Radar</Link>
      </p>
    </div>
  );
}
