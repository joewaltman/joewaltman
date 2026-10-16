# DCA license files runbook

Code: `packages/pipeline/src/adapters/dca.ts`. Settings: `content/dca-license-types.json`.

## Where the files come from

The Department of Consumer Affairs public information page (https://www.dca.ca.gov/consumers/public_info/index.shtml) links to a public Box folder with one subfolder per board. Each holds a tab-separated data file named `.xls` (some boards split it into `_Data00`, `_Data01`) and a counts file. DCA refreshes them at the start of each month.

The job runs daily at 5:35am Pacific. It reads the Box folder listing (about a dozen small page loads), and downloads a board's files only when Box shows a newer version than the last successful run, which keeps the versions in its `job_runs` meta. A full refresh is about 300 MB of downloads and a minute of processing.

## What is kept

Only organization rows (`Indiv/Org` = `O`) in San Diego County, of the license types listed per board in `content/dca-license-types.json`. A row whose name reads as a bare personal name ("FIRST LAST") is skipped even when the board marks it an organization. Street addresses are kept only for types marked `premises` (shops, salons, pharmacies); for the rest only city and ZIP. The archive keeps the header and San Diego rows of each file.

To read another board or license type, add it to the JSON with a NAICS code (which sets the Radar category). The Dental Board file is `.xlsx` and is not read yet.

## Events

- `new_business`: a license seen for the first time and issued in the last 45 days. Dated the day it first appears here (DCA posts about a month behind), with the issue date in the note, so it lands in that week's Radar.
- `dca_status_change`: the license status changed between monthly files (Active to Delinquent, say). Shown on the Watchlist.
- `dca_license_removed`: a license that was in last month's file and is gone. If more than 10% of a board's known licenses vanish at once, the job fails instead of recording them.

Event links go to the DCA license search page; the note carries the license number.

## When it breaks

- "DCA Box page has no folder listing": Box changed its page. Look at the page source of the Box folder link for the folder listing and update `parseBoxListing`. Until then, a board's file can be downloaded by hand from Box.
- "DCA <folder> file is missing columns": a board changed its header. Update the column names in `parseDca` and the fixture in `packages/pipeline/fixtures/dca/`.
- A board folder disappears or is renamed: the run's meta lists it under `missingFolders`. Update the folder name in the JSON.
