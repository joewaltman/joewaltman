import type { Metadata } from "next";
import Link from "next/link";
import { HandRaise } from "@/components/hand-raise";
import { ERP_PROMPT } from "@/components/watchlist-landing";

export const metadata: Metadata = { title: "Customer Watchlist in your ERP", robots: { index: false } };

// Where the weekly email's "click here" lands: one button, no account needed.
export default async function WatchlistErpPage({ searchParams }: { searchParams: Promise<{ raised?: string }> }) {
  const { raised } = await searchParams;
  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">The Watchlist, wired into your systems</h1>
      <p>
        Instead of reading the Monday email, a new filing on a customer can put a credit hold on their account in your
        ERP or QuickBooks, flag open invoices, and start a collections sequence on its own.
      </p>
      <p>Joe Waltman builds this kind of setup as a fixed-scope project, usually in about five days.</p>
      <HandRaise tool="watchlist" prompt={ERP_PROMPT} returnTo="/watchlist/erp" raised={raised === "1"} />
      <p className="mt-8">
        <Link href="/watchlist">Back to the Customer Watchlist</Link>
      </p>
    </div>
  );
}
