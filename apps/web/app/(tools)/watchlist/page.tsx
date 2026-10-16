import type { Metadata } from "next";
import { WatchlistLanding } from "@/components/watchlist-landing";

export const metadata: Metadata = {
  title: "Customer Watchlist",
  description:
    "A free weekly email of new public records on the customers you extend credit to: bankruptcy filings, federal lawsuits, license suspensions and bond cancellations.",
};

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<{ signup?: string; raised?: string }> }) {
  const { signup, raised } = await searchParams;
  return <WatchlistLanding status={signup} raised={raised === "1"} />;
}
