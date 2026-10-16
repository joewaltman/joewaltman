# Deploy, staging and rollback

## Where things run

- Railway project `proactive-respect`.
- `production` environment: service `joewaltman` deploys branch `main`, custom domain `joewaltman.com` (port 8080), Cloudflare DNS in front.
- `staging` environment: same service, deploys the current feature branch, at `https://joewaltman-staging.up.railway.app`. Has its own Postgres.

Service settings (build and start commands, the pipeline cron schedule, the bucket, and the list of variables) are defined in `.railway/railway.ts`. Railway does not read that file on deploy; apply it per environment:

```bash
railway environment staging
npx @railway/cli@5.63.1 config plan
npx @railway/cli@5.63.1 config apply
```

Read the plan before applying. A variable that is set in Railway but missing from the file is deleted on apply, so add every new variable to the file (secrets as `preserve()`) before or right after setting it in the dashboard. The installed CLI (4.35) predates the `config` command, hence `npx` with a pinned newer version.

Each web deploy runs `pnpm --filter @jw/db migrate` as the first step of the start command. If a migration fails, the new container never passes its health check and the old version keeps serving.

## Variables (web service)

| Name | Staging | Production |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `${{Postgres.DATABASE_URL}}` |
| `PORT` | `8080` | `8080` |
| `SITE_URL` | staging URL | `https://joewaltman.com` |
| `ADMIN_EMAIL` | `joe@joewaltman.com` | `joewaltman@gmail.com` (admin sign-in, hand-raise and job-failure notices) |
| `EMAIL_REPLY_TO` | not set | `joe@joewaltman.com` (where visitor replies go) |
| `SESSION_SECRET` | random, 64 hex chars | random, different from staging |
| `EMAIL_MODE` | `dryrun` until Resend is set up, then `joe-only` | `joe-only` until Joe says `live` |
| `EMAIL_DRYRUN_STDOUT` | `1` (prints dry-run emails to the log) | never set |
| `RESEND_API_KEY` | Joe sets | Joe sets |
| `MAIL_POSTAL_ADDRESS` | Joe sets | Joe sets (live mail refuses to send without it) |
| `BOOKING_URL` | optional | Joe's booking page |

Generate a session secret without printing it:

```bash
openssl rand -hex 32 | tr -d '\n' | railway variable set -s joewaltman -e production --stdin SESSION_SECRET
```

## Production cutover (one time)

1. Joe checks staging and says go.
2. Add Postgres to production: `railway environment production`, then `railway add --database postgres`, then `railway service joewaltman`.
3. Set the production variables above with `--skip-deploys`.
4. Merge the feature branch into `main` and push.
5. While linked to production, run `config plan`, check it creates only the bucket and the pipeline service and deletes nothing, then `config apply`. Set the pipeline's `ARCHIVE_S3_*` variables from `railway bucket credentials`.
6. Check `https://joewaltman.com` (homepage unchanged), `/tariffrefund`, `/admin/login`, and `/admin/jobs` after the next pipeline tick.

## Rollback

In the Railway dashboard, open the `joewaltman` service in `production`, pick the last good deployment and choose Redeploy. For the cutover, the last good deployment is the static site from September 1, 2026. Database migrations only add tables, so the old version runs fine against a newer database.

## Email modes

- `dryrun`: renders every email to `.email-out/` and sends nothing.
- `joe-only`: sends only to `ADMIN_EMAIL`; anything else is logged as `blocked`. Signups from other addresses are refused before anything is saved.
- `live`: sends normally. Only Joe switches to this, after the sending domain checks pass.
