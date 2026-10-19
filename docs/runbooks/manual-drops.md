# Manual drops runbook

For sources with no download to automate yet: the Secretary of State business entity file, UCC filings and liens, Labor Commissioner judgments and public works debarments, the County Recorder's grantor-grantee index, and county fictitious business names.

## Uploading

Sign in to `/admin/drops`, pick the source and upload the file (CSV, tab or pipe separated; `.gz` is fine). The upload streams line by line:

1. The header is checked against `content/manual-drops.json`. If a required column is missing, the upload is refused with a list of the file's columns; add the right header name to the JSON (headers are compared without case, spaces or punctuation), deploy, and upload again.
2. Statewide sources (SOS, UCC, Labor Commissioner judgments) are cut to San Diego County by their county or ZIP column.
3. The rest is stored gzipped in `manual_drops`. The pipeline reads it on the next tick (within 30 minutes) and the page shows rows kept, events added, rows skipped by reason, and which header matched each column.

## County fictitious business names, step by step

1. Open https://arcc-acclaim.sdcounty.ca.gov/FBN (or sdarcc.gov, Recorder/County Clerk, Fictitious Business Name, "FBN Records Search").
2. Under "FBN Download", click the icon. It downloads a CSV of every FBN filed in the last nine years. If a disclaimer appears first, read and accept it.
3. Optionally `gzip` the file to upload faster.
4. Upload it at `/admin/drops` as "San Diego County fictitious business names". Only filings from the last 120 days are kept, so most rows are dropped on purpose.
5. Repeat weekly, any day. New filings are dated the day the upload is read, so they reach the next Monday's Radar; overlapping uploads are skipped as duplicates.

The county site blocks automated downloads, so this stays a manual step unless the clerk offers an approved feed.

## What each source turns into

- SOS: an entity per entity number (the number shows on Watchlist matches). A new registration in the last 45 days is a Radar new business; a later file with a different status is `sos_status_change` (suspended or forfeited is serious), and a new statement of information date is `sos_statement_of_information`.
- UCC: by filing type, `tax_lien` and `judgment_lien` (serious), `ucc_filing` (worth a look), terminations and releases (for the record). Secured parties are named only when they are businesses.
- Labor Commissioner: `dlse_judgment` and `dlse_debarment`, both serious. A debarment with a CSLB license number attaches to that contractor's record.
- Recorder: by document type, the party the document is about (set per type as grantor or grantee in the JSON). Unlisted document types are skipped.
- Fictitious business names: a Radar new business. A person registrant makes it a sole proprietorship: no street address stored and the owner never named.

Every source records events only against businesses. Rows naming a person as the debtor, employer or party are skipped and counted.

A filing without a ZIP attaches to the one San Diego County business with exactly that name if there is one, and otherwise to an entity for that name and source.

## When the first real file arrives

Each source is marked `verify: true` until checked against a real file. After the first upload:

1. Compare "Columns used" on `/admin/drops` with the file, and fix any header that matched the wrong column.
2. For the recorder, check that grantor and grantee are the right way round for each document type.
3. Save a few rows to `packages/pipeline/fixtures/manual/` with people's names and street addresses replaced by REDACTED, and point the tests at them.
4. Set `verify` to false in `content/manual-drops.json`.
