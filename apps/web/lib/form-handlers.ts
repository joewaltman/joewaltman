import { aiworkRules, readAnswers, tariffRules, taxonomy, zipClusters } from "@jw/content";
import { ROLES, TOOLS, eq, handRaises, partners, prerunNotes, watchlistMutes } from "@jw/db";
import {
  WATCH_EVENT_TYPES,
  addCustomers,
  customersFromRows,
  parseCustomerLines,
  removeCustomer,
  reopenMatch,
  resolveMatch,
  watchlistEmail,
} from "@jw/pipeline/watchlist";
import { sendEmail } from "@jw/email";
import { parse as parseCsv } from "csv-parse/sync";
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
import { aiworkOpen, submitAiwork } from "./aiwork";
import { detectAts, fetchableUrl, readCareersPage } from "./ats";
import { CLIENT_BANDS } from "./radar-view";
import { currentAdmin, currentWatcher, emailDeps, sessionSecret, startWatchSession } from "./server";
import { confirmByToken, subscribe, unsubscribeByToken } from "./subscriptions";
import { requestBrokerReview, submitTariff } from "./tariff";
import { todayLabel } from "./tariff-view";
import { TOOL_INFO } from "./tools";
import { WATCH_COOKIE, consumeWatchToken, requestWatchLink, watcherByEmail } from "./watch-auth";
import { AR_BANDS, INDUSTRIES, REVENUE_BANDS, WATCH_ROLES, pick } from "./watch-view";

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
  bookingUrl: z.union([z.url(), z.literal("")]).transform((v) => v || null),
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
    const db = emailDeps().db;
    const result = await confirmByToken(db, field(form, "token") ?? "");
    if (!result) return "/confirm/result?invalid=1";
    // The Watchlist confirmation link doubles as the first sign-in.
    if (result.tool === "watchlist" && (await watcherByEmail(db, result.email))) {
      await startWatchSession(result.email);
      return "/watchlist/list?welcome=1";
    }
    return `/confirm/result?tool=${result.tool}`;
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

  async "aiwork-submit"(form) {
    const partner = slug.safeParse(form.get("partner"));
    const back = partner.success ? `/aiwork/p/${partner.data}` : "/aiwork";
    // Until an attorney's review is recorded, only Joe can run the checker, as a preview.
    const preview = !aiworkOpen(aiworkRules);
    if (preview && !(await currentAdmin())) return back;
    const { answers, errors } = readAnswers(aiworkRules, form);
    const first = Object.keys(errors)[0];
    if (first) return `${back}?error=${encodeURIComponent(first)}#q-${first}`;
    const { responseId, emailStatus } = await submitAiwork(emailDeps(), aiworkRules, {
      answers,
      wantsUpdates: form.get("updates") === "yes",
      partnerSlug: partner.success ? partner.data : null,
      preview,
      today: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()),
    });
    return `/aiwork/result/${responseId}?emailed=${emailStatus}`;
  },

  async "admin-aiwork-ats"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const url = fetchableUrl(field(form, "url") ?? "");
    if (!url) return "/admin/aiwork?ats=bad-url#prerun";
    const page = await readCareersPage(url);
    const found = detectAts(url.toString(), page);
    const vendors = found.length > 0 ? found.map((f) => `${f.vendor} (from the ${f.from === "url" ? "URL" : "page"})`).join(", ") : page ? "no known ATS found" : "page could not be read";
    const extra = (field(form, "note") ?? "").trim().slice(0, 1500);
    await emailDeps()
      .db.insert(prerunNotes)
      .values({ tool: "aiwork", subject: (field(form, "company") ?? "").trim().slice(0, 200) || url.hostname, url: url.toString(), note: [`ATS: ${vendors}`, extra].filter(Boolean).join(". ") });
    return "/admin/aiwork#prerun";
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

  async "watchlist-signup"(form) {
    const partner = slug.safeParse(form.get("partner"));
    const back = safeReturn(field(form, "returnTo"), "/watchlist");
    const email = z.email().max(254).safeParse(field(form, "email")?.trim());
    const company = field(form, "company")?.trim().slice(0, 200);
    if (!email.success || !company) return `${back}?signup=invalid#signup`;
    const jobRole = pick(WATCH_ROLES, field(form, "role"));
    const deps = emailDeps();
    const outcome = await subscribe(deps, {
      email: email.data,
      tool: "watchlist",
      name: field(form, "name")?.trim().slice(0, 200) || null,
      company,
      role: jobRole === "owner" ? "owner" : "other",
      revenueBand: pick(REVENUE_BANDS, field(form, "revenue")),
      partnerSlug: partner.success ? partner.data : null,
      preferences: { jobRole, industry: pick(INDUSTRIES, field(form, "industry")), arBand: pick(AR_BANDS, field(form, "ar")) },
    });
    // Someone who already has a list gets a sign-in link instead of a second confirmation.
    if (outcome === "already-subscribed") {
      await requestWatchLink(deps, email.data);
      return "/watchlist/sign-in?sent=1";
    }
    return `${back}?signup=${outcome}#signup`;
  },

  async "watchlist-link"(form) {
    const email = z.email().safeParse(field(form, "email")?.trim());
    if (email.success) await requestWatchLink(emailDeps(), email.data);
    return "/watchlist/sign-in?sent=1";
  },

  async "watchlist-sign-in"(form) {
    const email = await consumeWatchToken(emailDeps().db, field(form, "token") ?? "");
    if (!email || !(await watcherByEmail(emailDeps().db, email))) return "/watchlist/sign-in?expired=1";
    await startWatchSession(email);
    return "/watchlist/list";
  },

  async "watchlist-sign-out"() {
    const store = await cookies();
    store.delete(WATCH_COOKIE);
    return "/watchlist";
  },

  async "watchlist-add"(form) {
    const watcher = await currentWatcher();
    if (!watcher) return "/watchlist/sign-in";
    const inputs = parseCustomerLines(field(form, "names") ?? "");
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > 200_000) return "/watchlist/list?error=file-too-big#add";
      try {
        const rows = parseCsv(await file.text(), { bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
        inputs.push(...customersFromRows(rows));
      } catch {
        return "/watchlist/list?error=bad-file#add";
      }
    }
    if (inputs.length === 0) return "/watchlist/list?error=empty#add";
    const result = await addCustomers(emailDeps().db, watcher.watchlistId, inputs);
    const full = result.skipped.filter((x) => x.reason === "limit").length;
    const dupes = result.skipped.filter((x) => x.reason === "duplicate").length;
    return `/watchlist/list?added=${result.added}&full=${full}&dupes=${dupes}#customers`;
  },

  async "watchlist-pick"(form) {
    const watcher = await currentWatcher();
    if (!watcher) return "/watchlist/sign-in";
    const item = z.uuid().safeParse(form.get("item"));
    const choice = field(form, "entity");
    const entity = choice === "none" ? null : z.uuid().safeParse(choice).data;
    if (item.success && entity !== undefined) await resolveMatch(emailDeps().db, watcher.watchlistId, item.data, entity);
    return "/watchlist/list#review";
  },

  async "watchlist-reopen"(form) {
    const watcher = await currentWatcher();
    if (!watcher) return "/watchlist/sign-in";
    const item = z.uuid().safeParse(form.get("item"));
    if (item.success) await reopenMatch(emailDeps().db, watcher.watchlistId, item.data);
    return "/watchlist/list#review";
  },

  async "watchlist-remove"(form) {
    const watcher = await currentWatcher();
    if (!watcher) return "/watchlist/sign-in";
    const item = z.uuid().safeParse(form.get("item"));
    if (item.success) await removeCustomer(emailDeps().db, watcher.watchlistId, item.data);
    return "/watchlist/list#customers";
  },

  async "watchlist-mutes"(form) {
    const watcher = await currentWatcher();
    if (!watcher) return "/watchlist/sign-in";
    const shown = new Set(form.getAll("show").filter((v): v is string => typeof v === "string"));
    const muted = WATCH_EVENT_TYPES.filter((t) => !shown.has(t));
    const db = emailDeps().db;
    await db.delete(watchlistMutes).where(eq(watchlistMutes.watchlistId, watcher.watchlistId));
    if (muted.length > 0) await db.insert(watchlistMutes).values(muted.map((eventType) => ({ watchlistId: watcher.watchlistId, eventType })));
    return "/watchlist/list?saved=mutes#mutes";
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

  async "admin-watchlist-test"(form) {
    if (!(await currentAdmin())) return "/admin/login";
    const id = z.uuid().safeParse(form.get("watchlist"));
    if (!id.success) return "/admin/watchlist";
    const deps = emailDeps();
    const now = new Date();
    const email = await watchlistEmail(deps.db, id.data, new Date(now.getTime() - 7 * 86_400_000), now, deps.config.siteUrl);
    if (!email) return "/admin/watchlist?test=empty";
    const result = await sendEmail(deps, {
      to: deps.config.adminEmail,
      template: email.template,
      reason: "You got this because you asked for a test Watchlist email in the joewaltman.com admin.",
    });
    return `/admin/watchlist?test=${result.status}`;
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
