# joewaltman.com

Personal site plus four free SMB tools. Full spec: `docs/SPEC.md`.

## Rules

- Copy rule: plain English, no em dashes anywhere (code comments and emails included), no hype words.
- Ask before: spending money, sending email to anyone but Joe, scraping a new source, changing DNS.
- Never scrape bizfileonline.sos.ca.gov, sdcourt.ca.gov, Yelp, Indeed, LinkedIn or Google results.
- Legal and rate facts live in content/*.json with source URLs and as-of dates; never hardcode them in components.
- Entity-level public data only; no individuals, no scores.
- Every ingestion job: idempotent, archived raw file, job_runs row, failure email to Joe.
- Run the parser and rules tests before every commit.

## Where things run

- Railway project `proactive-respect`, service `joewaltman`, serves `joewaltman.com` (custom domain, port 8080, Cloudflare DNS in front).
- Production deploys from `main` on GitHub (`joewaltman/joewaltman`). Joe prefers shipping straight to `main` without a staging pass (decided October 16, 2026): run the tests and build locally, push, then check the live site. The `staging` environment still exists but is optional.
- Postgres and the raw-file storage bucket live in the same Railway project.
- Ingestion runs from the Railway `pipeline` cron service (`pnpm --filter @jw/pipeline tick` every 30 minutes), not GitHub Actions. The tick decides what is due in America/Los_Angeles time. See `docs/runbooks/pipeline.md`.
- Railway service settings live in `.railway/railway.ts` (Infrastructure as Code; `railway.json` is deprecated). Apply per environment with `railway config plan` then `railway config apply` (CLI 5.63 or newer). Every variable a service uses must be listed there, with `preserve()` for secrets: a variable left out is deleted on apply. Always read the plan before applying.

## Decisions that differ from the spec

- Hosting: one Next.js app on the existing Railway service (not Vercel plus proxy).
- Database: Railway Postgres (not Neon or Supabase).
- Raw archive: Railway Storage Bucket, San Diego County rows only, gzipped, 60-day retention (not R2).
- Build order: thin spine, Tariff tool, ingestion spine, Radar, Watchlist, AI-at-Work.
- Email sends from the root domain `joewaltman.com` through Resend (Joe's call), not a subdomain. Setup: `docs/runbooks/email-setup.md`.

## Email safety

`EMAIL_MODE` controls every send path:
- `dryrun`: render to HTML files under `.email-out/`, send nothing.
- `joe-only`: refuse any recipient other than `ADMIN_EMAIL` (production: joewaltman@gmail.com, which is also the admin sign-in address; replies go to joe@joewaltman.com via `EMAIL_REPLY_TO`).
- `live`: normal sending. Only Joe switches to this.

## Commands

- `pnpm install`
- `pnpm dev` (web app on localhost:3000)
- `pnpm test` (Vitest across all packages; DB tests use PGlite)
- `pnpm typecheck`
- `pnpm db:generate` (Drizzle migration from schema changes)
- `pnpm db:migrate` (apply migrations to `DATABASE_URL`)
- `pnpm --filter @jw/db dev-db` (in-memory Postgres on port 5433 for local runs; start the app with `DATABASE_POOL_MAX=1`, since it cannot interleave connections)
