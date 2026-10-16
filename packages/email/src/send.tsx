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

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(eq(suppressions.email, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}

export async function sendEmail(deps: SendDeps, input: SendInput): Promise<SendResult> {
  const { db, config } = deps;
  const to = normalizeEmail(input.to);
  const { template } = input;

  const log = async (status: EmailStatus, extra: { providerId?: string; error?: string } = {}) => {
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
    const error = `EMAIL_MODE is joe-only; refused to send to ${to}`;
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
    replyTo: config.replyTo,
    subject: template.subject,
    html: await render(element),
    text: await render(element, { plainText: true }),
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
