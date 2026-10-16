import { type Db, authTokens, subscribers, subscriptions, watchlists } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { OutgoingMessage, SendDeps } from "@jw/email";
import { beforeEach, describe, expect, it } from "vitest";
import { consumeLoginToken, createSessionValue, requestLoginLink, verifySessionValue } from "./admin-auth";
import { confirmByToken, subscribe } from "./subscriptions";
import { consumeWatchToken, requestWatchLink, watcherByEmail } from "./watch-auth";

let db: Db;
let sent: OutgoingMessage[];
let deps: SendDeps;
const ADMIN = "joewaltman@gmail.com";

const linkIn = (m: OutgoingMessage, path: string) => m.text.match(new RegExp(`https://joewaltman\\.com${path}([A-Za-z0-9_-]+)`))![1]!;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  deps = {
    db,
    transport: {
      async send(m) {
        sent.push(m);
        return { id: `fake-${sent.length}` };
      },
    },
    config: {
      mode: "live",
      adminEmail: ADMIN,
      from: "Joe Waltman <joe@joewaltman.com>",
      replyTo: "joe@joewaltman.com",
      siteUrl: "https://joewaltman.com",
      postalAddress: "PO Box 1, Encinitas, CA 92024",
      resendApiKey: null,
      dryRunDir: "/tmp/unused",
    },
  };
});

async function confirmedWatcher(email: string) {
  await subscribe(deps, { email, tool: "watchlist", company: "Acme Supply" });
  await confirmByToken(db, linkIn(sent.at(-1)!, "/confirm/"));
}

describe("watchlist sign-in", () => {
  it("only sends links to confirmed Watchlist users, and creates their list on first use", async () => {
    await requestWatchLink(deps, "nobody@example.com");
    await subscribe(deps, { email: "pending@example.com", tool: "watchlist" });
    const before = sent.length;
    await requestWatchLink(deps, "pending@example.com");
    expect(sent.length).toBe(before);

    await confirmedWatcher("ar@example.com");
    expect(await db.select().from(watchlists)).toHaveLength(0);
    await requestWatchLink(deps, "AR@example.com");
    const token = linkIn(sent.at(-1)!, "/watchlist/auth/");
    expect(sent.at(-1)!.subject).toBe("Your Customer Watchlist sign-in link");
    expect(await consumeWatchToken(db, token)).toBe("ar@example.com");
    expect(await consumeWatchToken(db, token)).toBeNull();
    const w = await watcherByEmail(db, "ar@example.com");
    expect(w?.watchlistId).toBeTruthy();
    expect(await db.select().from(watchlists)).toHaveLength(1);
  });

  it("keeps admin and Watchlist tokens and cookies apart", async () => {
    await confirmedWatcher(ADMIN);
    await requestWatchLink(deps, ADMIN);
    const watchToken = linkIn(sent.at(-1)!, "/watchlist/auth/");
    expect(await consumeLoginToken(db, watchToken, ADMIN)).toBeNull();
    await requestLoginLink(deps, ADMIN);
    const adminToken = linkIn(sent.at(-1)!, "/admin/auth/");
    expect(await consumeWatchToken(db, adminToken)).toBeNull();
    expect(await consumeLoginToken(db, adminToken, ADMIN)).toBe(ADMIN);

    const watchCookie = createSessionValue(ADMIN, "s", Date.now(), "watchlist");
    expect(verifySessionValue(watchCookie, "s")).toBeNull();
    expect(verifySessionValue(watchCookie, "s", Date.now(), "watchlist")).toBe(ADMIN);
    expect(verifySessionValue(createSessionValue(ADMIN, "s"), "s", Date.now(), "watchlist")).toBeNull();
  });

  it("does not open a list for someone who unsubscribed", async () => {
    await confirmedWatcher("ar@example.com");
    await db.update(subscriptions).set({ active: false });
    expect(await watcherByEmail(db, "ar@example.com")).toBeNull();
    await db.update(subscriptions).set({ active: true });
    await db.update(subscribers).set({ unsubscribedAt: new Date() });
    expect(await watcherByEmail(db, "ar@example.com")).toBeNull();
    expect(await db.select().from(authTokens)).toHaveLength(1);
  });
});
