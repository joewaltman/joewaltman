import { readAnswers, tariffRules, taxonomy, zipClusters } from "@jw/content";
import { ROLES, TOOLS, eq, handRaises, partners, prerunNotes } from "@jw/db";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  consumeLoginToken,
  createSessionValue,
  requestLoginLink,
} from "./admin-auth";
import { recordHandRaise } from "./hand-raise";
import { pickAreas, sendTestDigest } from "./radar-admin";
import { CLIENT_BANDS } from "./radar-view";
import { currentAdmin, emailDeps, sessionSecret } from "./server";
import { confirmByToken, subscribe, unsubscribeByToken } from "./subscriptions";
import { requestBrokerReview, submitTariff } from "./tariff";
import { todayLabel } from "./tariff-view";
import { TOOL_INFO } from "./tools";

// Every form on the site posts to /api/forms/<name>. Each handler does the work and returns the
// path to send the visitor to. Plain URLs keep working across deploys; Next.js server action IDs
// change with every build, so a page left open over a deploy could not be submitted.
export type FormHandler = (form: FormData) => Promise<string>;

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
}

// Only same-site paths, so a form cannot be used as an open redirect.
function safeReturn(path: string | null, fallback: string): string {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

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

const slug = z.string().regex(/^[a-z0-9-]{2,60}$/);

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

export const FORM_HANDLERS: Record<string, FormHandler> = {
  async signup(form) {
    const tool = TOOLS.find((t) => t === field(form, "tool")) ?? "tariff";
    const back = safeReturn(field(form, "returnTo"), TOOL_INFO[tool].path);
    const parsed = signupSchema.safeParse({
      tool: field(form, "tool"),
      email: field(form, "email")?.trim(),
      name: field(form, "name"),
      company: field(form, "company"),
      role: field(form, "role") || null,
      partner: field(form, "partner"),
    });
    if (!parsed.success) return `${back}?signup=invalid#signup`;
    const d = parsed.data;
    const outcome = await subscribe(emailDeps(), {
      email: d.email,
      tool: d.tool,
      name: d.name ?? null,
      company: d.company ?? null,
      role: d.role ?? null,
      partnerSlug: d.partner ?? null,
    });
    return `${back}?signup=${outcome}#signup`;
  },

  async "radar-signup"(form) {
    const partner = slug.safeParse(form.get("partner"));
    const back = safeReturn(field(form, "returnTo"), "/newbizradar");
    const clusters = form.getAll("clusters").filter((v): v is string => typeof v === "string" && Object.hasOwn(zipClusters.clusters, v));
    const known = new Set(taxonomy.categories.map((c) => c.id));
    const categories = form.getAll("categories").filter((v): v is string => typeof v === "string" && known.has(v));
    if (clusters.length === 0) return `${back}?signup=no-area#signup`;
    const parsed = signupSchema.safeParse({
      tool: "radar",
      email: field(form, "email")?.trim(),
      name: field(form, "name"),
      company: field(form, "company"),
      role: field(form, "role") || null,
      partner: partner.success ? partner.data : null,
    });
    if (!parsed.success) return `${back}?signup=invalid#signup`;
    const d = parsed.data;
    const clients = field(form, "clients");
    const outcome = await subscribe(emailDeps(), {
      email: d.email,
      tool: "radar",
      name: d.name ?? null,
      company: d.company ?? null,
      role: d.role ?? null,
      partnerSlug: d.partner ?? null,
      preferences: {
        zipClusters: clusters,
        categories,
        frequency: "weekly",
        sells: field(form, "sells")?.trim().slice(0, 200) || null,
        clientsBand: clients && CLIENT_BANDS.some(([v]) => v === clients) ? clients : null,
      },
    });
    return `${back}?signup=${outcome}#signup`;
  },

  async confirm(form) {
    const result = await confirmByToken(emailDeps().db, field(form, "token") ?? "");
    return result ? `/confirm/result?tool=${result.tool}` : "/confirm/result?invalid=1";
  },

  async unsubscribe(form) {
    const token = field(form, "token") ?? "";
    await unsubscribeByToken(emailDeps().db, token);
    return `/u/${encodeURIComponent(token)}`;
  },

  async "hand-raise"(form) {
    const back = safeReturn(field(form, "returnTo"), "/");
    const tool = TOOLS.find((t) => t === field(form, "tool"));
    if (!tool) return back;
    const email = z.email().safeParse(field(form, "email")?.trim());
    const note = field(form, "note")?.trim().slice(0, 2000) || null;
    await recordHandRaise(emailDeps(), {
      tool,
      email: email.success ? email.data : null,
      context: { path: back, note },
    });
    return `${back}${back.includes("?") ? "&" : "?"}raised=1#hand-raise`;
  },

  async "tariff-submit"(form) {
    const partner = slug.safeParse(form.get("partner"));
    const back = partner.success ? `/tariffrefund/p/${partner.data}` : "/tariffrefund";
    const { answers, errors } = readAnswers(tariffRules, form);
    const first = Object.keys(errors)[0];
    if (first) return `${back}?error=${encodeURIComponent(first)}#q-${first}`;
    const { responseId, emailStatus } = await submitTariff(emailDeps(), tariffRules, {
      answers,
      wantsUpdates: form.get("updates") === "yes",
      partnerSlug: partner.success ? partner.data : null,
      today: todayLabel(),
    });
    return `/tariffrefund/result/${responseId}?emailed=${emailStatus}`;
  },

  async "broker-review"(form) {
    const id = z.uuid().safeParse(form.get("responseId"));
    if (!id.success) return "/tariffrefund";
    if (form.get("consent") !== "yes") return `/tariffrefund/result/${id.data}?review=consent#broker`;
    const outcome = await requestBrokerReview(emailDeps(), tariffRules, {
      responseId: id.data,
      defaultBrokerSlug: process.env.TARIFF_BROKER_SLUG || null,
      today: todayLabel(),
    });
    return `/tariffrefund/result/${id.data}?review=${outcome}#broker`;
  },

  async "admin-login"(form) {
    const email = field(form, "email");
    if (email) await requestLoginLink(emailDeps(), email);
    return "/admin/login?sent=1";
  },

  async "admin-sign-in"(form) {
    const deps = emailDeps();
    const email = await consumeLoginToken(deps.db, field(form, "token") ?? "", deps.config.adminEmail);
    if (!email) return "/admin/login?error=expired";
    const store = await cookies();
    store.set(SESSION_COOKIE, createSessionValue(email, sessionSecret()), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return "/admin";
  },

  async "admin-sign-out"() {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return "/admin/login";
  },

  async "admin-partner"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const parsed = partnerSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return `/admin/partners?error=${encodeURIComponent(message)}`;
    }
    await emailDeps()
      .db.insert(partners)
      .values(parsed.data)
      .onConflictDoUpdate({ target: partners.slug, set: parsed.data });
    return "/admin/partners";
  },

  async "admin-hand-raise-handled"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const id = field(form, "id") ?? "";
    if (z.uuid().safeParse(id).success) {
      await emailDeps().db.update(handRaises).set({ handledAt: new Date() }).where(eq(handRaises.id, id));
    }
    return "/admin/hand-raises";
  },

  async "admin-radar-test"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const clusters = pickAreas(form.getAll("areas").filter((v): v is string => typeof v === "string"));
    const result = await sendTestDigest(emailDeps(), clusters);
    return `/admin/radar?${clusters.map((c) => `areas=${c}`).join("&")}&test=${result.status}`;
  },

  async "admin-prerun-note"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const tool = z.enum(TOOLS).catch("tariff").parse(form.get("tool"));
    const subject = (field(form, "subject") ?? "").trim().slice(0, 200);
    const note = (field(form, "note") ?? "").trim().slice(0, 2000) || null;
    const back = safeReturn(field(form, "returnTo"), "/admin");
    if (subject) {
      const url = tool === "tariff" ? `https://www.importyeti.com/search?q=${encodeURIComponent(subject)}` : null;
      await emailDeps().db.insert(prerunNotes).values({ tool, subject, url, note });
    }
    return back.startsWith("/admin") ? back : "/admin";
  },
};
