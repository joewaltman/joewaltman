# Ingestion pipeline runbook

Code: `packages/pipeline`. Runs as the Railway `pipeline` service, which Railway starts every 30 minutes (`pnpm --filter @jw/pipeline tick`). Each tick runs whatever the Pacific-time schedule in `packages/pipeline/src/jobs.ts` says is due and exits.

| Job | Time (Pacific) | What it does |
|---|---|---|
| `archive-prune` | 4:00am | Deletes raw downloads older than 60 days from the bucket |
| `sd-biztax` | 5:30am | City of San Diego business tax certificates created in the last 10 days |
| `abc` | 5:30am | ABC daily export (San Diego County licenses) plus the last 3 days of issued, new application and status change reports |
| `cslb` | 5:30am | CSLB master license file, San Diego County; events from comparing with the previous run |
| `enrich` | 5:45am | Category and one-line summary for new businesses (needs `ANTHROPIC_API_KEY`) |

Every run writes a `job_runs` row (see `/admin/jobs`). A failed job is retried once at the next tick; each failure emails Joe. Re-runs are safe: entities match on source identifiers and events dedupe on a key.

A deploy or variable change restarts the pipeline service and cuts off a run in progress. That run stays "running" until the first tick two hours later marks it failed ("Interrupted"), and the scheduler retries it. To avoid it, don't deploy between 5:30 and 6:30am Pacific.

Enrichment only covers businesses with an event in the last 30 days. The first load of a source creates thousands of existing businesses with no event; they are not summarized.

## Running a job by hand

```bash
pnpm pipeline list
pnpm pipeline run sd-biztax
```

Locally, start a throwaway database first (`pnpm --filter @jw/db dev-db`, then `pnpm db:migrate` with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres`) and set `DATABASE_POOL_MAX=1`. Without bucket variables the archive goes to `.archive/` on disk.

## When a source changes its format

Each adapter checks the columns it depends on and fails with a message naming the source, for example "ABC export has no File Number or Prem County column; the format changed". To fix:

1. Download the file from the URL in the adapter (`packages/pipeline/src/adapters/<source>.ts`) and look at the new header.
2. Update the column names in the adapter.
3. Replace or extend the fixture in `packages/pipeline/fixtures/<source>/` with real rows from the new file, removing anything that names a person.
4. Run `pnpm test`, commit, deploy. The next tick picks the job back up.

The raw download for every run is in the bucket under `<source>/<YYYY-MM-DD>/`, so a day can be reprocessed after a fix.

## Source notes

- **sd-biztax** (`seshat.datasd.org/business_tax_certificates/`): files rebuild around 2:07am Pacific. New accounts cancelled soon after move to the inactive file, so both are read. The portal's terms say downloading counts as accepting them; the data itself is public domain (ODC-PDDL).
- **abc** (`www.abc.ca.gov`): the export's first line is a title, not the header. Commas inside names are replaced by spaces. Reports are cached by ABC's host for up to 4 hours and land late, hence the 3-day re-read. Transfers appear as license numbers.
- **cslb** (`www.cslb.ca.gov` DataPortal): the 78 MB download is sometimes cut short with no error. The adapter checks for a CRLF ending and more than 200,000 lines, retries up to four times, and refuses to record removals for more than 5% of known licenses in one run. Licenses missing from the file are recorded once as removed (expired, cancelled or revoked).

## Privacy rules the adapters follow

- Sole proprietors and individual licensees are kept only under a trade name that is not their own name, with no street address or phone.
- Mailing addresses and personal name columns are dropped before anything is stored.
- Fixtures contain only businesses, or clearly synthetic rows.
