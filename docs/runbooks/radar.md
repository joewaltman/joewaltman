# New Business Radar runbook

Public pages: `/newbizradar` (landing, sample digest, signup), `/newbizradar/[cluster]` (last week for one area, name, type and city only), `/newbizradar/p/[slug]` (partner co-brand), `/newbizradar/crm` (where the digest's "click here" lands). Subscriber CSVs: `/newbizradar/csv/[token]`. Admin: `/admin/radar`.

## Where the data comes from

The pipeline's `sd-biztax`, `abc` and `cslb` jobs record `new_business` and license events; `enrich` adds the category and one-line note. See `pipeline.md`. Areas are the ZIP clusters in `content/zip-clusters.json`; kinds of business are `content/taxonomy.json`.

## The Monday send

The `radar-digest` job runs Mondays at 6:00am Pacific and covers the seven days ending Sunday. Each confirmed subscriber gets their areas and kinds, a CSV link signed with `SESSION_SECRET`, and a quiet-week note when nothing turned up. A retry the same week skips anyone already sent. Avoid deploying between 5:30 and 6:30am Pacific on weekdays.

## Checking a digest before Monday

`/admin/radar` shows last week's digest for any areas exactly as the email lists it. "Email me this digest" sends it to `ADMIN_EMAIL` only; its CSV link is the admin export, which needs you signed in.

## Partner pages

Add a partner in `/admin/partners` with tool `radar`. The page is then live at `/newbizradar/p/<slug>`, shows "Shared with you by <name>" and the logo, and signups made there are credited to the partner.
