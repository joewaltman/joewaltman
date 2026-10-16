import "server-only";
import { randomBytes } from "node:crypto";
import { getDb } from "@jw/db";
import { type SendDeps, loadEmailConfig } from "@jw/email";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionValue } from "./admin-auth";

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
