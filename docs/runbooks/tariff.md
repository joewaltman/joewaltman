# Tariff Refund Tool runbook

Public pages: `/tariffrefund` (questionnaire), `/tariffrefund/result/[id]`, `/tariffrefund/calculator`, `/tariffrefund/p/[slug]` (partner co-brand). Admin: `/admin/tariff`.

## Where the rules live

Everything factual is in `content/tariff-rules.json`:

- `facts`: each statement with `sources`, `asOf` and `verify`. A fact with `verify: true` is listed under "Needs broker review" in admin, and any copy that cites it is hidden from the public.
- `questions`: the ten questions plus the import value qualifier.
- `rules`: ordered; the first rule whose `when` matches picks the path. `fallbackPath` covers the rest.
- `paths`: the copy for each result. Text items that state a fact cite it as `{ "text": ..., "facts": [...] }`.
- `actions`: extra sections added when answers match (for example ACH not on file).
- `calculator`: categories with Section 232 rates today and on the future date, countries with Section 301 rates, fees.

The code never hardcodes a rate or date. The engine is `packages/content/src/tariff/`.

## Refreshing the rules

1. Edit `content/tariff-rules.json`. Bump `version` (date plus a counter) and `asOf`, and update the `asOf` of any fact you rechecked.
2. Run `pnpm test`. The rules tests fail on a missing reference, an em dash, an unsourced fact that is not marked verify, or a public path that would show an unverified fact.
3. If a refund path changed, add or update a scenario in `packages/content/src/tariff/scenarios.test.ts`.
4. Commit and deploy. Stored results keep the rules version they were made with.

## After the broker reviews

For each fact the broker confirms: set `verify` to `false`, add the source the broker relied on if it is new, and update `asOf`. The hidden copy appears on the next deploy. For a fact the broker corrects, change the text first. `s301-more-countries` needs code-free follow-up: add the confirmed countries to `calculator.countries`.

Calculator switches that follow verify flags: `s301-exemptions` (applies the Section 232 and USMCA exemptions instead of showing a range), `s301-net-of-mfn` (nets the rate against the base duty for EU, Taiwan, Japan, Korea), `mpf-min` (shows the processing fee), `broker-fee-range` (shows the typical broker fee).

## HTS base rates

The calculator calls `https://hts.usitc.gov/reststop/search?keyword=<8-digit code>` and caches each code for a week in the `hts_rates` table, misses included. If the USITC changes its response format, `pickGeneralRate` in `packages/content/src/tariff/hts.ts` and its tests are the place to fix. If the service is down, the page leaves the base duty out and says so; a stale cached rate is used when there is one.

## Broker review routing

"Ask a broker to review" appears when there is a partner with `tool = tariff` and a contact email, either the partner the visitor came through (`/tariffrefund/p/[slug]`) or the one named in the `TARIFF_BROKER_SLUG` variable. Add partners in `/admin/partners`. Requests are logged as `broker_review` events and listed in `/admin/tariff`.

## Pre-run helper

`/admin/tariff` turns an importer name into an ImportYeti search link and keeps a note. It only builds the link. ImportYeti's terms have not been checked for automation, so nothing fetches from it.
