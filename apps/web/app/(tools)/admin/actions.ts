"use server";

import { eq, handRaises, partners, prerunNotes, TOOLS } from "@jw/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  consumeLoginToken,
  createSessionValue,
  requestLoginLink,
} from "@/lib/admin-auth";
import { emailDeps, requireAdmin, sessionSecret } from "@/lib/server";

export async function requestLoginAction(form: FormData): Promise<void> {
  const email = form.get("email");
  if (typeof email === "string") await requestLoginLink(emailDeps(), email);
  redirect("/admin/login?sent=1");
}

export async function signInAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const deps = emailDeps();
  const email = await consumeLoginToken(deps.db, token, deps.config.adminEmail);
  if (!email) redirect("/admin/login?error=expired");
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionValue(email, sessionSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/admin/login");
}

const partnerSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,60}$/, "Lowercase letters, numbers and dashes only"),
  name: z.string().trim().min(1).max(200),
  contactEmail: z.union([z.email(), z.literal("")]).transform((v) => v || null),
  logoUrl: z.union([z.url(), z.literal("")]).transform((v) => v || null),
  tool: z.union([z.enum(TOOLS), z.literal("")]).transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
});

export async function addPartnerAction(form: FormData): Promise<void> {
  await requireAdmin();
  const parsed = partnerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    redirect(`/admin/partners?error=${encodeURIComponent(message)}`);
  }
  await emailDeps()
    .db.insert(partners)
    .values(parsed.data)
    .onConflictDoUpdate({ target: partners.slug, set: parsed.data });
  redirect("/admin/partners");
}

export async function markHandledAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (z.uuid().safeParse(id).success) {
    await emailDeps().db.update(handRaises).set({ handledAt: new Date() }).where(eq(handRaises.id, id));
  }
  redirect("/admin/hand-raises");
}

export async function prerunNoteAction(form: FormData): Promise<void> {
  await requireAdmin();
  const tool = z.enum(TOOLS).catch("tariff").parse(form.get("tool"));
  const subject = String(form.get("subject") ?? "").trim().slice(0, 200);
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || null;
  const back = String(form.get("returnTo") ?? "/admin");
  if (subject) {
    const url =
      tool === "tariff" ? `https://www.importyeti.com/search?q=${encodeURIComponent(subject)}` : null;
    await emailDeps().db.insert(prerunNotes).values({ tool, subject, url, note });
  }
  redirect(back.startsWith("/admin") ? back : "/admin");
}
