import { createHmac, timingSafeEqual } from "node:crypto";
import { type Db, and, authTokens, eq, gt, isNull, normalizeEmail } from "@jw/db";
import { type SendDeps, magicLink, maskEmail, sendEmail } from "@jw/email";
import { hashToken, newToken } from "./tokens";

const LOGIN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "jw_admin";

// Always returns quietly so the form does not reveal which address is the admin.
export async function requestLoginLink(deps: SendDeps, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (email !== deps.config.adminEmail) {
    console.log(`[admin login] link requested for ${maskEmail(email)}, which is not the admin address; nothing sent`);
    return;
  }
  const token = newToken();
  await deps.db.insert(authTokens).values({
    email,
    tokenHash: hashToken(token),
    purpose: "login",
    expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
  });
  await sendEmail(deps, {
    to: email,
    template: magicLink({ url: `${deps.config.siteUrl}/admin/auth/${token}` }),
    reason: "You got this because someone asked for a sign-in link at joewaltman.com/admin.",
    bypassSuppression: true,
  });
}

export async function consumeLoginToken(
  db: Db,
  token: string,
  adminEmail: string,
): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, "login"),
        // Watchlist sign-in tokens carry a tool; the admin's do not.
        isNull(authTokens.tool),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row || row.email !== adminEmail) return null;
  return row.email;
}

// The scope keeps a Watchlist session from passing as an admin session. Admin cookies were signed
// before scopes existed, so the admin scope signs the bare payload.
export type SessionScope = "admin" | "watchlist";

function sign(payload: string, secret: string, scope: SessionScope): string {
  return createHmac("sha256", secret)
    .update(scope === "admin" ? payload : `${scope}:${payload}`)
    .digest("base64url");
}

export function createSessionValue(email: string, secret: string, now = Date.now(), scope: SessionScope = "admin"): string {
  const payload = `${Buffer.from(email).toString("base64url")}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload, secret, scope)}`;
}

export function verifySessionValue(
  value: string | undefined,
  secret: string,
  now = Date.now(),
  scope: SessionScope = "admin",
): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [emailPart, expPart, sig] = parts as [string, string, string];
  const expected = sign(`${emailPart}.${expPart}`, secret, scope);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!(Number(expPart) > now)) return null;
  return Buffer.from(emailPart, "base64url").toString();
}
