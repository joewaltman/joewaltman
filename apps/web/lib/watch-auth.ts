import { type Db, and, authTokens, eq, gt, isNotNull, isNull, normalizeEmail, subscribers, subscriptions, watchlists } from "@jw/db";
import { type SendDeps, magicLink, maskEmail, sendEmail } from "@jw/email";
import { hashToken, newToken } from "./tokens";

const LINK_TTL_MS = 30 * 60 * 1000;
export const WATCH_COOKIE = "jw_watch";

export interface Watcher {
  subscriberId: string;
  email: string;
  watchlistId: string;
}

// A confirmed subscriber with an active Watchlist subscription, and their list (made on first use).
export async function watcherByEmail(db: Db, rawEmail: string): Promise<Watcher | null> {
  const email = normalizeEmail(rawEmail);
  const [row] = await db
    .select({ id: subscribers.id, email: subscribers.email })
    .from(subscribers)
    .innerJoin(subscriptions, and(eq(subscriptions.subscriberId, subscribers.id), eq(subscriptions.tool, "watchlist")))
    .where(and(eq(subscribers.email, email), eq(subscriptions.active, true), isNotNull(subscribers.confirmedAt), isNull(subscribers.unsubscribedAt)))
    .limit(1);
  if (!row) return null;
  await db.insert(watchlists).values({ subscriberId: row.id }).onConflictDoNothing();
  const [list] = await db.select({ id: watchlists.id }).from(watchlists).where(eq(watchlists.subscriberId, row.id)).limit(1);
  return { subscriberId: row.id, email: row.email, watchlistId: list!.id };
}

// Always quiet, so the form does not reveal who has a Watchlist.
export async function requestWatchLink(deps: SendDeps, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!(await watcherByEmail(deps.db, email))) {
    console.log(`[watchlist sign-in] link requested for ${maskEmail(email)}, which has no active Watchlist; nothing sent`);
    return;
  }
  const token = newToken();
  await deps.db.insert(authTokens).values({
    email,
    tokenHash: hashToken(token),
    purpose: "login",
    tool: "watchlist",
    expiresAt: new Date(Date.now() + LINK_TTL_MS),
  });
  await sendEmail(deps, {
    to: email,
    template: { ...magicLink({ url: `${deps.config.siteUrl}/watchlist/auth/${token}` }), subject: "Your Customer Watchlist sign-in link" },
    reason: "You got this because someone asked for a Customer Watchlist sign-in link for this address.",
  });
}

export async function consumeWatchToken(db: Db, token: string): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, "login"),
        eq(authTokens.tool, "watchlist"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  return row?.email ?? null;
}
