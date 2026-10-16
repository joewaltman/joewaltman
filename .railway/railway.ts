import { bucket, defineRailway, github, preserve, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Postgres was created
// separately and is not managed here, so this file never touches it.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "joewaltman";

// Apply per environment: link with `railway environment <name>`, then `railway config plan`
// and `railway config apply`. Nothing here runs on push.
export default defineRailway((ctx) => {
  const production = ctx.environment === "production";
  const source = github("joewaltman/joewaltman", { branch: production ? "main" : "tools-spine" });

  // The website: homepage, tools and admin. Migrations run before the server starts, so a
  // failed migration never takes traffic.
  // Every variable a service uses must be listed: one left out is deleted on the next apply.
  // preserve() keeps whatever value is set in Railway, so secrets never live in this file.
  const joewaltman = service("joewaltman", {
    source,
    build: "pnpm --filter web build",
    start: "pnpm --filter @jw/db migrate && pnpm --filter web start",
    healthcheck: "/",
    env: {
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      PORT: "8080",
      SITE_URL: preserve(),
      ADMIN_EMAIL: preserve(),
      SESSION_SECRET: preserve(),
      EMAIL_MODE: preserve(),
      EMAIL_FROM: preserve(),
      RESEND_API_KEY: preserve(),
      MAIL_POSTAL_ADDRESS: preserve(),
      BOOKING_URL: preserve(),
      TARIFF_BROKER_SLUG: preserve(),
      ...(production ? {} : { EMAIL_DRYRUN_STDOUT: preserve() }),
    },
  });

  // Raw downloads kept 60 days so any ingestion run can be reprocessed.
  const archive = bucket("pipeline-archive", { region: "sjc" });

  // Ingestion, enrichment and archive pruning. Railway starts it every 30 minutes; the tick
  // runs whatever the Pacific-time schedule says is due and exits.
  const pipeline = service("pipeline", {
    source,
    build: "pnpm --filter @jw/pipeline typecheck",
    start: "pnpm --filter @jw/pipeline tick",
    deploy: { cronSchedule: "*/30 * * * *", restartPolicyType: "NEVER" },
    env: {
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      // Email settings follow the website, so Joe sets them once.
      EMAIL_MODE: "${{joewaltman.EMAIL_MODE}}",
      ADMIN_EMAIL: "${{joewaltman.ADMIN_EMAIL}}",
      SITE_URL: "${{joewaltman.SITE_URL}}",
      EMAIL_FROM: "${{joewaltman.EMAIL_FROM}}",
      MAIL_POSTAL_ADDRESS: "${{joewaltman.MAIL_POSTAL_ADDRESS}}",
      RESEND_API_KEY: "${{joewaltman.RESEND_API_KEY}}",
      // Secrets set by hand in Railway; never written here.
      ANTHROPIC_API_KEY: preserve(),
      ARCHIVE_S3_ENDPOINT: preserve(),
      ARCHIVE_S3_BUCKET: preserve(),
      ARCHIVE_S3_ACCESS_KEY_ID: preserve(),
      ARCHIVE_S3_SECRET_ACCESS_KEY: preserve(),
      ARCHIVE_S3_REGION: preserve(),
    },
  });

  return project("proactive-respect", {
    resources: [joewaltman, archive, pipeline],
  });
});
