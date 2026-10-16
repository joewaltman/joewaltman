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
  const rawMode = env.EMAIL_MODE ?? "dryrun";
  if (!(EMAIL_MODES as readonly string[]).includes(rawMode)) {
    throw new Error(`EMAIL_MODE must be one of ${EMAIL_MODES.join(", ")}; got "${rawMode}"`);
  }
  const adminEmail = (env.ADMIN_EMAIL ?? "joe@joewaltman.com").trim().toLowerCase();
  return {
    mode: rawMode as EmailMode,
    adminEmail,
    from: env.EMAIL_FROM ?? "Joe Waltman <joe@joewaltman.com>",
    replyTo: env.EMAIL_REPLY_TO ?? adminEmail,
    siteUrl: (env.SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    postalAddress: env.MAIL_POSTAL_ADDRESS?.trim() || null,
    resendApiKey: env.RESEND_API_KEY?.trim() || null,
    dryRunDir: env.EMAIL_DRYRUN_DIR ?? path.join(process.cwd(), ".email-out"),
    dryRunStdout: env.EMAIL_DRYRUN_STDOUT === "1",
  };
}
