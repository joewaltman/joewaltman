/** @jsxRuntime automatic @jsxImportSource react */
// The pipeline runs this package through tsx, which only applies a tsconfig to files inside that
// config's include, so the JSX transform is pinned here rather than left to the caller's config.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Db, type EmailStatus, emailSends, eq, normalizeEmail, suppressions } from "@jw/db";
import { render } from "@react-email/components";
import type { EmailConfig } from "./config";
import { Layout } from "./templates/layout";
import type { Template } from "./templates";
import { type OutgoingMessage, type Transport, resendTransport } from "./transport";

export interface SendInput {
  to: string;
  template: Template;
  // The "why you got this" line in the footer.
  reason: string;
  // Set for list mail (digests, alerts, results). Adds List-Unsubscribe headers and the footer link.
  subscriber?: { id: string; unsubscribeToken: string } | null;
  showForward?: boolean;
  // Only for Joe's own sign-in links, so an unsubscribe on a test signup cannot lock him out of admin.
  bypassSuppression?: boolean;
  // Defaults to Joe. A broker review request sets it to the importer so the broker replies to them.
  replyTo?: string;
}

export interface SendResult {
  status: EmailStatus;
  providerId?: string;
  error?: string;
  dryRunFile?: string;
}

export interface SendDeps {
  db: Db;
  config: EmailConfig;
  transport?: Transport;
}

export function unsubscribeUrls(siteUrl: string, token: string) {
  return {
    page: `${siteUrl}/u/${token}`,
    oneClick: `${siteUrl}/api/unsubscribe?t=${token}`,
  };
}

// "joe@joewaltman.com" -> "j***@joewaltman.com"
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(eq(suppressions.email, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}

// A template as the HTML a reader would see, with a sample footer, for admin previews.
export async function previewHtml(template: Template, postalAddress = "[postal address]"): Promise<string> {
  return render(
    <Layout preview={template.preview} footer={{ reason: "Preview: this is how the email looks to a subscriber.", postalAddress, unsubscribeUrl: "#", showForward: true }}>
      {template.body}
    </Layout>,
  );
}

// The footer as plain text, for templates that write their own plain-text part.
function footerText(input: SendInput, postalAddress: string | null, unsubscribeUrl: string | undefined): string {
  return [
    input.reason,
    input.showForward ? "Know someone who would use this? Forward it to them." : "",
    unsubscribeUrl ? `Unsubscribe from these emails: ${unsubscribeUrl}` : "",
    `Joe Waltman, ${postalAddress ?? "[postal address not set]"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function sendEmail(deps: SendDeps, input: SendInput): Promise<SendResult> {
  const { db, config } = deps;
  const to = normalizeEmail(input.to);
  const { template } = input;

  const log = async (status: EmailStatus, extra: { providerId?: string; error?: string } = {}) => {
    // One line per send in the service log, so a missing email can be traced without the database.
    const line = `[email] ${template.name} to ${maskEmail(to)}: ${status}${extra.error ? ` (${extra.error})` : ""}`;
    if (status === "failed" || status === "blocked") console.error(line);
    else console.log(line);
    await db.insert(emailSends).values({
      subscriberId: input.subscriber?.id ?? null,
      toEmail: to,
      template: template.name,
      subject: template.subject,
      mode: config.mode,
      status,
      providerId: extra.providerId ?? null,
      error: extra.error ?? null,
    });
  };

  if (!input.bypassSuppression && (await isSuppressed(db, to))) {
    await log("suppressed");
    return { status: "suppressed" };
  }

  if (config.mode === "joe-only" && to !== config.adminEmail) {
    const error = `EMAIL_MODE is joe-only; refused to send to ${maskEmail(to)}`;
    await log("blocked", { error });
    return { status: "blocked", error };
  }

  if (config.mode === "live" && !config.postalAddress) {
    const error = "MAIL_POSTAL_ADDRESS is not set; live mail needs a physical address in the footer";
    await log("failed", { error });
    return { status: "failed", error };
  }

  const urls = input.subscriber
    ? unsubscribeUrls(config.siteUrl, input.subscriber.unsubscribeToken)
    : null;

  const element = (
    <Layout
      preview={template.preview}
      footer={{
        reason: input.reason,
        postalAddress: config.postalAddress ?? "[postal address not set]",
        unsubscribeUrl: urls?.page,
        showForward: input.showForward,
      }}
    >
      {template.body}
    </Layout>
  );

  const headers: Record<string, string> = {};
  if (urls) {
    headers["List-Unsubscribe"] = `<${urls.oneClick}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const message: OutgoingMessage = {
    from: config.from,
    to,
    replyTo: input.replyTo ?? config.replyTo,
    subject: template.subject,
    html: await render(element),
    text: template.text ? `${template.text}\n\n----------------------------------------\n\n${footerText(input, config.postalAddress, urls?.page)}` : await render(element, { plainText: true }),
    headers,
  };

  if (config.mode === "dryrun") {
    const file = await writeDryRun(config.dryRunDir, message, template.name);
    await log("dryrun");
    console.log(`[email dryrun] ${template.name} to ${to}: ${file}`);
    if (config.dryRunStdout) console.log(`[email dryrun body]\n${message.text}`);
    return { status: "dryrun", dryRunFile: file };
  }

  const transport =
    deps.transport ?? (config.resendApiKey ? resendTransport(config.resendApiKey) : null);
  if (!transport) {
    const error = "RESEND_API_KEY is not set";
    await log("failed", { error });
    return { status: "failed", error };
  }

  let providerId: string;
  try {
    ({ id: providerId } = await transport.send(message));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await log("failed", { error });
    return { status: "failed", error };
  }
  await log("sent", { providerId });
  return { status: "sent", providerId };
}

async function writeDryRun(dir: string, m: OutgoingMessage, name: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-${name}`);
  const headerLines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Reply-To: ${m.replyTo}`,
    `Subject: ${m.subject}`,
    ...Object.entries(m.headers).map(([k, v]) => `${k}: ${v}`),
  ];
  await writeFile(`${base}.html`, `<!--\n${headerLines.join("\n")}\n-->\n${m.html}`);
  await writeFile(`${base}.txt`, `${headerLines.join("\n")}\n\n${m.text}`);
  return `${base}.html`;
}
