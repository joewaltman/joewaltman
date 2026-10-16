import "server-only";
import { randomBytes } from "node:crypto";
import { getDb } from "@jw/db";
import { type SendDeps, loadEmailConfig } from "@jw/email";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionValue, verifySessionValue } from "./admin-auth";
import { WATCH_COOKIE, type Watcher, watcherByEmail } from "./watch-auth";

export function emailDeps(): SendDeps {
  return { db: getDb(), config: loadEmailConfig() };
}

let devSecret: string | undefined;
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is not set");
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

export async function currentAdmin(): Promise<string | null> {
  const store = await cookies();
  const email = verifySessionValue(store.get(SESSION_COOKIE)?.value, sessionSecret());
  return email && email === loadEmailConfig().adminEmail ? email : null;
}

export async function requireAdmin(): Promise<string> {
  const email = await currentAdmin();
  if (!email) redirect("/admin/login");
  return email;
}

export function bookingUrl(): string {
  return process.env.BOOKING_URL || "mailto:joe@joewaltman.com";
}

export async function currentWatcher(): Promise<Watcher | null> {
  const store = await cookies();
  const email = verifySessionValue(store.get(WATCH_COOKIE)?.value, sessionSecret(), Date.now(), "watchlist");
  return email ? watcherByEmail(getDb(), email) : null;
}

export async function requireWatcher(): Promise<Watcher> {
  const watcher = await currentWatcher();
  if (!watcher) redirect("/watchlist/sign-in");
  return watcher;
}

export async function startWatchSession(email: string): Promise<void> {
  const store = await cookies();
  store.set(WATCH_COOKIE, createSessionValue(email, sessionSecret(), Date.now(), "watchlist"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
