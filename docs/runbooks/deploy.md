# Deploy and rollback

## Where things run

- Railway project `proactive-respect`.
- `production` environment: service `joewaltman` deploys branch `main`, custom domain `joewaltman.com` (port 8080), Cloudflare DNS in front.
- There is no staging environment; Joe ships straight to `main` (October 16, 2026).

Service settings (build and start commands, the pipeline cron schedule, the bucket, and the list of variables) are defined in `.railway/railway.ts`. Railway does not read that file on deploy; apply it per environment:

```bash
npx @railway/cli@5.63.1 config plan
npx @railway/cli@5.63.1 config apply
```

Read the plan before applying. A variable that is set in Railway but missing from the file is deleted on apply, so add every new variable to the file (secrets as `preserve()`) before or right after setting it in the dashboard. The installed CLI (4.35) predates the `config` command, hence `npx` with a pinned newer version.

Each web deploy runs `pnpm --filter @jw/db migrate` as the first step of the start command. If a migration fails, the new container never passes its health check and the old version keeps serving.

## Variables (web service, production)

| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres-XFjk.DATABASE_URL}}` (set by `.railway/railway.ts`) |
| `PORT` | `8080` (the custom domain points at it) |
| `SITE_URL` | `https://joewaltman.com` |
| `ADMIN_EMAIL` | `joewaltman@gmail.com` (admin sign-in, hand-raise and job-failure notices) |
| `EMAIL_REPLY_TO` | `joe@joewaltman.com` (where visitor replies go) |
| `SESSION_SECRET` | random, 64 hex characters |
| `EMAIL_MODE` | `live` (switched by Joe on October 16, 2026) |
| `EMAIL_FROM` | `Joe Waltman <joe@joewaltman.com>` |
| `RESEND_API_KEY` | Joe sets |
| `MAIL_POSTAL_ADDRESS` | Joe sets (live mail refuses to send without it) |
| `ANTHROPIC_API_KEY` | Joe sets; the pipeline reads it from here |
| `BOOKING_URL` | optional, Joe's booking page |

The `pipeline` service reads the email settings and the Anthropic key from the web service through `${{joewaltman.NAME}}` references, so each is set once.

Generate a session secret without printing it:

```bash
openssl rand -hex 32 | tr -d '\n' | railway variable set -s joewaltman -e production --stdin SESSION_SECRET
```

## Rollback

In the Railway dashboard, open the `joewaltman` service in `production`, pick the last good deployment and choose Redeploy. Database migrations only add tables, so the old version runs fine against a newer database.

## Email modes

- `dryrun`: renders every email to `.email-out/` and sends nothing.
- `joe-only`: sends only to `ADMIN_EMAIL`; anything else is logged as `blocked`. Signups from other addresses are refused before anything is saved.
- `live`: sends normally. Only Joe switches to this, after the sending domain checks pass.
