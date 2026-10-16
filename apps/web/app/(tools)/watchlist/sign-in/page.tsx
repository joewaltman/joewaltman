import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign in to your Customer Watchlist", robots: { index: false } };

export default async function WatchlistSignInPage({ searchParams }: { searchParams: Promise<{ sent?: string; expired?: string }> }) {
  const { sent, expired } = await searchParams;
  return (
    <div className="prose-plain">
      <h1 className="mb-3 text-[2rem] leading-tight font-semibold">Sign in to your Customer Watchlist</h1>
      {sent ? (
        <p className="notice">If that address has a watchlist, a sign-in link is on its way. It works once, for 30 minutes.</p>
      ) : null}
      {expired ? <p className="notice">That link expired or was already used. Ask for a new one below.</p> : null}
      <form method="post" action="/api/forms/watchlist-link" className="grid max-w-md gap-3">
        <label className="grid gap-1">
          <span className="font-semibold">Email</span>
          <input className="field" type="email" name="email" required autoComplete="email" />
        </label>
        <div>
          <button type="submit" className="btn">
            Email me a sign-in link
          </button>
        </div>
      </form>
      <p className="mt-8">
        No watchlist yet? <Link href="/watchlist#signup">Start one</Link>.
      </p>
    </div>
  );
}
