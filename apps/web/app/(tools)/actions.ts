"use server";

import { ROLES, TOOLS } from "@jw/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordHandRaise } from "@/lib/hand-raise";
import { emailDeps } from "@/lib/server";
import { confirmByToken, subscribe, unsubscribeByToken } from "@/lib/subscriptions";
import { TOOL_INFO } from "@/lib/tools";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => v || null)
  .nullable()
  .optional();

const signupSchema = z.object({
  tool: z.enum(TOOLS),
  email: z.email().max(254),
  name: optionalText,
  company: optionalText,
  role: z.enum(ROLES).nullable().optional().catch(null),
  partner: optionalText,
});

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
}

// Only same-site paths, so the form cannot be used as an open redirect.
function safeReturn(path: string | null, fallback: string): string {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

export async function signupAction(form: FormData): Promise<void> {
  const parsed = signupSchema.safeParse({
    tool: field(form, "tool"),
    email: field(form, "email")?.trim(),
    name: field(form, "name"),
    company: field(form, "company"),
    role: field(form, "role") || null,
    partner: field(form, "partner"),
  });
  const tool = TOOLS.find((t) => t === field(form, "tool")) ?? "tariff";
  const back = safeReturn(field(form, "returnTo"), TOOL_INFO[tool].path);
  if (!parsed.success) redirect(`${back}?signup=invalid#signup`);

  const d = parsed.data;
  const outcome = await subscribe(emailDeps(), {
    email: d.email,
    tool: d.tool,
    name: d.name ?? null,
    company: d.company ?? null,
    role: d.role ?? null,
    partnerSlug: d.partner ?? null,
  });
  redirect(`${back}?signup=${outcome}#signup`);
}

export async function confirmAction(form: FormData): Promise<void> {
  const token = field(form, "token") ?? "";
  const result = await confirmByToken(emailDeps().db, token);
  redirect(result ? `/confirm/result?tool=${result.tool}` : "/confirm/result?invalid=1");
}

export async function unsubscribeAction(form: FormData): Promise<void> {
  const token = field(form, "token") ?? "";
  await unsubscribeByToken(emailDeps().db, token);
  redirect(`/u/${encodeURIComponent(token)}`);
}

export async function handRaiseAction(form: FormData): Promise<void> {
  const tool = TOOLS.find((t) => t === field(form, "tool"));
  const back = safeReturn(field(form, "returnTo"), "/");
  if (!tool) redirect(back);
  const email = z.email().safeParse(field(form, "email")?.trim());
  const note = field(form, "note")?.trim().slice(0, 2000) || null;
  await recordHandRaise(emailDeps(), {
    tool,
    email: email.success ? email.data : null,
    context: { path: back, note },
  });
  redirect(`${back}${back.includes("?") ? "&" : "?"}raised=1#hand-raise`);
}
