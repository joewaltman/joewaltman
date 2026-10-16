import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// Signing in takes a click, so link scanners that open emails cannot use up the link.
export default async function WatchlistAuthPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div>
      <h1 className="mb-4 text-[1.75rem] font-semibold">Sign in to your Customer Watchlist</h1>
      <form method="post" action="/api/forms/watchlist-sign-in">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn">
          Sign in
        </button>
      </form>
    </div>
  );
}
