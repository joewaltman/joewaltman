import path from "node:path";

export const EMAIL_MODES = ["dryrun", "joe-only", "live"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];

export interface EmailConfig {
  mode: EmailMode;
  adminEmail: string;
  from: string;
  replyTo: string;
  siteUrl: string;
  // Required by CAN-SPAM in every commercial email. Sending in live mode refuses without it.
  postalAddress: string | null;
  resendApiKey: string | null;
  dryRunDir: string;
  // Staging only: print dry-run emails to the log so links can be tested before Resend is set up.
  dryRunStdout?: boolean;
}

export function loadEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  // Railway references to an unset variable arrive as empty strings, so empty means unset.
  const get = (key: string) => env[key]?.trim() || undefined;
  const rawMode = get("EMAIL_MODE") ?? "dryrun";
  if (!(EMAIL_MODES as readonly string[]).includes(rawMode)) {
    throw new Error(`EMAIL_MODE must be one of ${EMAIL_MODES.join(", ")}; got "${rawMode}"`);
  }
  const adminEmail = (get("ADMIN_EMAIL") ?? "joe@joewaltman.com").toLowerCase();
  return {
    mode: rawMode as EmailMode,
    adminEmail,
    from: get("EMAIL_FROM") ?? "Joe Waltman <joe@joewaltman.com>",
    replyTo: get("EMAIL_REPLY_TO") ?? adminEmail,
    siteUrl: (get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
    postalAddress: get("MAIL_POSTAL_ADDRESS") ?? null,
    resendApiKey: get("RESEND_API_KEY") ?? null,
    dryRunDir: get("EMAIL_DRYRUN_DIR") ?? path.join(process.cwd(), ".email-out"),
    dryRunStdout: env.EMAIL_DRYRUN_STDOUT === "1",
  };
}
