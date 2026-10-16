# Deploy, staging and rollback

## Where things run

- Railway project `proactive-respect`.
- `production` environment: service `joewaltman` deploys branch `main`, custom domain `joewaltman.com` (port 8080), Cloudflare DNS in front.
- `staging` environment: same service, deploys the current feature branch, at `https://joewaltman-staging.up.railway.app`. Has its own Postgres.

Each deploy runs `pnpm --filter @jw/db migrate` before the new version takes traffic (`railway.json`, `preDeployCommand`). A failed migration stops the deploy and the old version keeps serving.

## Variables (web service)

| Name | Staging | Production |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | `${{Postgres.DATABASE_URL}}` |
| `PORT` | `8080` | `8080` |
| `SITE_URL` | staging URL | `https://joewaltman.com` |
| `ADMIN_EMAIL` | `joe@joewaltman.com` | `joe@joewaltman.com` |
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
4. Merge the feature branch into `main` and push. Railway builds and deploys it.
5. Check `https://joewaltman.com` (homepage unchanged), `/tariffrefund`, `/admin/login`.

## Rollback

In the Railway dashboard, open the `joewaltman` service in `production`, pick the last good deployment and choose Redeploy. For the cutover, the last good deployment is the static site from September 1, 2026. Database migrations only add tables, so the old version runs fine against a newer database.

## Email modes

- `dryrun`: renders every email to `.email-out/` and sends nothing.
- `joe-only`: sends only to `ADMIN_EMAIL`; anything else is logged as `blocked`. Signups from other addresses are refused before anything is saved.
- `live`: sends normally. Only Joe switches to this, after the sending domain checks pass.
