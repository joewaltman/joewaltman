import { createHmac, timingSafeEqual } from "node:crypto";
import { type Db, and, authTokens, eq, gt, isNull, normalizeEmail } from "@jw/db";
import { type SendDeps, magicLink, sendEmail } from "@jw/email";
import { hashToken, newToken } from "./tokens";

const LOGIN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "jw_admin";

// Always returns quietly so the form does not reveal which address is the admin.
export async function requestLoginLink(deps: SendDeps, rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (email !== deps.config.adminEmail) return;
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
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row || row.email !== adminEmail) return null;
  return row.email;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionValue(email: string, secret: string, now = Date.now()): string {
  const payload = `${Buffer.from(email).toString("base64url")}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionValue(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [emailPart, expPart, sig] = parts as [string, string, string];
  const expected = sign(`${emailPart}.${expPart}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!(Number(expPart) > now)) return null;
  return Buffer.from(emailPart, "base64url").toString();
}
