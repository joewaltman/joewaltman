# Ingestion pipeline runbook

Code: `packages/pipeline`. Runs as the Railway `pipeline` service, which Railway starts every 30 minutes (`pnpm --filter @jw/pipeline tick`). Each tick runs whatever the Pacific-time schedule in `packages/pipeline/src/jobs.ts` says is due and exits.

| Job | Time (Pacific) | What it does |
|---|---|---|
| `archive-prune` | 4:00am | Deletes raw downloads older than 60 days from the bucket |
| `sd-biztax` | 5:30am | City of San Diego business tax certificates created in the last 10 days |
| `abc` | 5:30am | ABC daily export (San Diego County licenses) plus the last 3 days of issued, new application and status change reports |
| `cslb` | 5:30am | CSLB master license file, San Diego County; events from comparing with the previous run |
| `dca` | 5:35am | DCA board license files from the public Box folder; reads only boards that posted a new file (monthly). See `dca.md` |
| `nppes` | 5:40am | CMS weekly NPI file: new San Diego healthcare organizations for the Radar, deactivations for the Watchlist. Individual providers are never read |
| `sba` | 5:40am | SBA 7(a) and 504 loan files (quarterly): new San Diego loans over $250,000 since the previous file. The first run only records the file date |
| `enrich` | 5:45am | Category and one-line summary for new businesses (needs `ANTHROPIC_API_KEY`) |
| `websites` | 5:47am | Looks for the website of each new business from the last 30 days: tries the obvious .com names and keeps one only if the page names the business and its location and is not a parked domain. Each business is tried once |
| `courtlistener` | 5:50am | Federal dockets naming Watchlist customers. See `watchlist.md` |
| `dockets` | 5:55am | New filings in the court cases listed in `content/watched-dockets.json` (the IEEPA refund class action), emailed to Joe. Needs `COURTLISTENER_API_TOKEN` |
| `radar-digest` | 6:00am Mondays, again at 9:00am | The New Business Radar email. The 9:00 slot only sends if the early one failed |
| `watchlist-digest` | 6:15am Mondays, again at 9:00am | The Customer Watchlist email, with the same catch-up |
| `manual-drops` | Next tick after an upload | Files uploaded at `/admin/drops`. See `manual-drops.md` |

Every run writes a `job_runs` row (see `/admin/jobs`). A failed job is retried once at the next tick. Only the retry's failure emails Joe, so a source that refuses for a few minutes and then recovers sends nothing; both failures are on `/admin/jobs`. A job started with Run now emails on any failure. A failure email that cannot be built or sent is logged and the tick carries on. Downloads try four times over about three minutes before a job counts as failed. The tick exits normally even when a job fails, so Railway only reports a crashed deployment when something outside the jobs breaks. Re-runs are safe: entities match on source identifiers and events dedupe on a key.

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

- NPPES: the downloads page at https://download.cms.gov/nppes/NPI_Files.html lists the weekly zips. The job reads each week once (the first run only the latest) and keeps the list of weeks read in its `job_runs` meta. Taxonomy codes map to labels and categories in `content/npi-taxonomy.json`. Authorized official names on organization records are never stored. When CMS takes the download site down for maintenance (it did on October 21, 2026), the job logs it and succeeds without reading anything, then reads the missed weeks once the site is back. It fails and emails Joe only if the outage lasts more than 14 days; check the page by hand then.
- SBA: the dataset page at https://data.sba.gov/dataset/7a-504-foia links the current `FOIA_7a_FY2020_Present` and `FOIA_504_FY2010_Present` files (about 240 MB together). A loan is recorded when it first appears with an approval date after the previous file's as-of date, dated the day it appears so it reaches that week's Radar; the approval date is in the note. Borrowers marked INDIVIDUAL and cancelled loans are left out. When SBA starts a new range file (FY2030), the pattern in `sbaFiles` still matches "Present".

- **sd-biztax** (`seshat.datasd.org/business_tax_certificates/`): files rebuild around 2:07am Pacific. New accounts cancelled soon after move to the inactive file, so both are read. The portal's terms say downloading counts as accepting them; the data itself is public domain (ODC-PDDL).
- **abc** (`www.abc.ca.gov`): the export's first line is a title, not the header. Commas inside names are replaced by spaces. Reports are cached by ABC's host for up to 4 hours and land late, hence the 3-day re-read. Transfers appear as license numbers.
- **cslb** (`www.cslb.ca.gov` DataPortal): the 78 MB download is sometimes cut short with no error. The adapter checks for a CRLF ending and more than 200,000 lines, retries up to four times, and refuses to record removals for more than 5% of known licenses in one run. Licenses missing from the file are recorded once as removed (expired, cancelled or revoked).

## Privacy rules the adapters follow

- Sole proprietors and individual licensees are kept only under a trade name that is not their own name, with no street address or phone.
- Mailing addresses and personal name columns are dropped before anything is stored.
- Fixtures contain only businesses, or clearly synthetic rows.
