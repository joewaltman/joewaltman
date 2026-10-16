# Build spec: four free tools at joewaltman.com

Paste this whole file into Claude Code as the first message, or save it as `docs/SPEC.md` in the project and start with: "Read docs/SPEC.md in full, then enter plan mode and give me the phased plan plus the questions you need answered before scaffolding."

## 0. Who you are building for and why

You are building four free web tools for Joe Waltman (joewaltman.com), a technical founder in Encinitas, California who sells custom AI and automation builds (fixed scope, about five days each) to owner-run small and mid-size businesses in Southern California. The tools exist to earn conversations with owners and with the intermediaries who refer them: CPAs, bankers, insurance agents, employment attorneys, HR consultants, customs brokers.

Every tool must:

* Give the user an asset (a list, a report, an alert stream), never a score or a grade.
* Work with as little input as possible: a business name, a ZIP, or ten questions.
* End in an email subscription or a saved result, so Joe has a recurring reason to send.
* Surface the manual process behind the result, with one low-pressure call to action ("want this wired into your systems?") that logs a hand-raise and emails Joe.
* Stay inside the terms of every data source listed below.
* Read as plain, direct English. No em dashes anywhere (copy, emails, code comments). No hype words.

The four tools and their public paths:

1. New Business Radar at `joewaltman.com/newbizradar`
2. Tariff Refund Tool at `joewaltman.com/tariffrefund`
3. Customer Watchlist at `joewaltman.com/watchlist`
4. California AI-at-Work Checker at `joewaltman.com/aiwork`

Recommended build order is the order above (reasons in Section 9). Joe may reorder; the shared spine in Section 4 always comes first.

## 1. Non-negotiable rules for this project

* Ask Joe before: spending money (the Secretary of State bulk file, any paid API, domains), sending email to any real address other than Joe's, scraping a source not on the approved list in 4.4, adding a paid service, or changing DNS.
* Never scrape: `bizfileonline.sos.ca.gov` (terms prohibit scrapers and commercial use of site content; use the bulk file or the API), `sdcourt.ca.gov` (terms prohibit bots and data mining), Yelp, Indeed, LinkedIn, Google search results. For sources marked VERIFY, build the adapter against a manual CSV drop folder first and flag the open question to Joe.
* Public data only, entity-level only. No consumer data, no reports on individuals, no credit scores, no "risk rating" language. FCRA stays out of scope by design.
* Every legal, regulatory or rate statement lives in a content file (`content/*.json`) with a source URL and an as-of date, and the page shows that date. Do not invent rates, dates, statutes or thresholds. Use the facts in Appendix A and mark anything beyond them VERIFY for Joe's attorney or customs broker partner.
* Every email: real physical address in the footer, one-click unsubscribe (List-Unsubscribe and List-Unsubscribe-Post headers), truthful subject lines, sent from a dedicated subdomain. CAN-SPAM and California B&P 17529.5 apply to B2B mail.
* Secrets in environment variables only. Never commit keys.
* Small commits. Tests for every parser and rules engine. A failing ingestion job emails Joe; it never fails silently.

## 2. Start here: discovery before scaffolding

1. Find out how joewaltman.com is hosted today. Ask Joe for the repo and host if it is not obvious from the working directory. Integration options, in order of preference:
   * (a) The site is already a Next.js or similar app: add the four route groups to it.
   * (b) The site is static or on another host: build the tools as a separate Next.js app on Vercel and serve the four paths through rewrites or the host's proxy, so the public URLs stay `joewaltman.com/newbizradar` and so on.
   * (c) Neither works cleanly: serve from `tools.joewaltman.com` with redirects at the four paths, and tell Joe the tradeoff (weaker SEO for the public radar pages).
2. Confirm with Joe: hosting account, DNS access, the sending subdomain for email (`mail.joewaltman.com` suggested), the Postgres provider (Neon or Supabase free tier), whether Resend is acceptable for email, and approval to order the Secretary of State bulk file (about $100).
3. Enter plan mode. Produce a phased plan with the "done when" criteria from Sections 5 to 8 and the list of open questions. Wait for Joe's answers on anything that costs money or touches DNS. Then build Phase 0.

## 3. Architecture (defaults; change only with a stated reason)

* Monorepo with pnpm workspaces, TypeScript throughout.
   * `apps/web`: Next.js (App Router), Tailwind. Route groups `/newbizradar`, `/tariffrefund`, `/watchlist`, `/aiwork`, plus `/admin`, `/privacy`, `/terms`. Server actions or route handlers for forms.
   * `packages/db`: Drizzle ORM schema and migrations on Postgres.
   * `packages/pipeline`: ingestion jobs, one module per source, run by GitHub Actions cron (free) with `pnpm pipeline run <job>`. Every job is idempotent, writes a `job_runs` row, and archives the raw download to object storage (Cloudflare R2 or S3) under a date-stamped key so anything can be reprocessed.
   * `packages/llm`: thin wrapper over the Claude API (Anthropic SDK). Default to the current Sonnet-class model (`claude-sonnet-5-5` as of October 2026) for summaries and enrichment and the Haiku-class model for bulk classification. Use prompt caching. Log token spend per job.
   * `packages/email`: Resend client, templates (React Email), send log, suppression list.
   * `content/`: rules and rates as versioned JSON with source URLs and as-of dates (`aiwork-rules.json`, `tariff-rules.json`, `taxonomy.json`, `zip-clusters.json`), plus copy.
   * `docs/`: this spec, runbooks, data-source notes.
* Auth: email magic links, no passwords. Joe's email is the only admin.
* Analytics: an `events` table (page view, signup, result viewed, hand-raise, unsubscribe). Plausible only if Joe asks. No third-party trackers in emails beyond Resend's open and click tracking.
* Schedules (Pacific time): ingestion daily at 5:30am; digests Monday 6:00am; watchlist alerts Monday 6:30am.
* Shared UI: one header ("Free tools from Joe Waltman", with a "Work with me" link to a booking page Joe supplies), typography consistent with the main site, mobile first, no heavy client JavaScript on landing pages.

## 4. The shared spine (Phase 0)

Build once. The Radar and the Watchlist both run on it.

### 4.1 Data model (Drizzle)

* `entities`: id, canonical_name, dba, entity_type, status, formed_at, address fields, zip, zip_cluster, county, naics, category, website, phone, created_at, updated_at.
* `entity_identifiers`: entity_id, source (sos, sd_biztax, fbn, abc, cslb, dca, nppes, sba, ucc, recap, dlse, recorder, osha), source_id, raw jsonb, first_seen, last_seen. Unique on (source, source_id).
* `entity_events`: id, entity_id, source, event_type, event_date, severity (info, watch, serious), title, summary, source_url, raw jsonb, dedupe_key. Unique on dedupe_key.
* `subscribers`: id, email, name, company, role (cpa, banker, insurance, payroll, cre, attorney, hr, owner, other), revenue_band, headcount_band, partner_id, consent_at, confirmed_at, unsubscribed_at.
* `subscriptions`: subscriber_id, tool (radar, watchlist, tariff, aiwork), preferences jsonb (zip_clusters, categories, frequency), active.
* `partners`: id, slug, name, logo_url, contact_email, tool, notes. Co-branded landing pages render from this table.
* `watchlists`, `watchlist_items` (watchlist_id, entity_id nullable, raw_name, confirmed), `match_candidates` (watchlist_item_id, entity_id, confidence).
* `questionnaire_responses`: tool, subscriber_id, answers jsonb, result jsonb, rules_version.
* `hand_raises`: subscriber_id, tool, context jsonb, created_at. Every "want this built" click lands here and emails Joe.
* `email_sends`, `job_runs`, `events`.

### 4.2 Entity resolution

* Normalize names (strip punctuation, entity suffixes such as LLC, Inc, Corp, leading "the") and addresses (a small normalizer for unit, street type and case).
* Match on exact identifiers first (SOS entity number, CSLB license number, NPI, business tax account), then name plus ZIP, then fuzzy name within county with a confidence score.
* Store candidates. The Watchlist asks the user to confirm any match below 0.9.

### 4.3 Enrichment

* `zip-clusters.json`: San Diego County ZIPs mapped to clusters (North County coastal, North County inland, central San Diego, South Bay, East County), Orange County later.
* Category from NAICS when present, otherwise LLM classification from name plus license type into a 20-item taxonomy in `taxonomy.json` that Joe can edit.
* Optional website guess: try obvious domains and verify with a HEAD request. Do not add a paid lookup API without asking.
* One-line summary per entity via LLM, cached on the entity row.

### 4.4 Ingestion adapters

One module per source with the same interface: `fetch`, `parse`, `upsert`, plus a fixture test with a real sample file (PII-free rows).

Approved to automate now:

* City of San Diego business tax certificates. Daily CSV at https://data.sandiego.gov/datasets/business-listings. New business = certificate created in the last 7 days. Fields include owner, ownership type, business start date, DBA, NAICS, address, council district.
* California ABC licenses. Daily export zip (CSV) at https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip with the layout at https://www.abc.ca.gov/weekly-data-export-fixed-width-layout-definition/, plus the daily HTML reports (issued licenses, new applications, status changes with transfer-from, transfer-to and escrow columns) at https://www.abc.ca.gov/licensing/licensing-reports and https://www.abc.ca.gov/licensing/licensing-reports/prior-reports. Filter to San Diego County. Events: new application, issued, transfer, escrow, suspension, revocation.
* CSLB. Monthly master file and county lists from https://www.cslb.ca.gov/onlineservices/dataportal/ and https://www.cslb.ca.gov/OnlineServices/DataPortal/ContractorList. Record layout (https://www.cslb.ca.gov/Resources/FormsAndApplications/License_Master_Record_Layout_LBL780J1.pdf): license number, status codes, classification, business names, mailing address, business phone, bond fields with cancellation dates, workers comp indicator, dates. No email. Diff month over month: new licenses, status changes, bond cancellations, workers comp indicator changes.
* DCA professional license files. Monthly files for 150-plus license types at https://www.dca.ca.gov/consumers/public_info/index.shtml. Diff for new licenses and status changes in San Diego County; map license types to categories (dental, medical, veterinary, cosmetology, accountancy, and so on).
* SBA 7(a) and 504 loans. Quarterly FOIA CSV at https://data.sba.gov/dataset/7a-504-foia. Capital events for San Diego County ZIPs over $250,000.
* NPPES. Weekly incremental files at https://download.cms.gov/nppes/NPI_Files.html. New organizational NPIs in San Diego County; map taxonomy to practice type.
* CourtListener RECAP. API with a free key (docs: https://wiki.free.law/c/courtlistener/help/api). Searches and alerts for bankruptcy and civil cases naming watchlist entities; respect rate limits. Also used by the Tariff tool to watch the Court of International Trade docket in Freestyle World v. CBP.
* DOL OSHA inspections and violations. DOL Open Data Portal v4 API with a free key (inspection and violation datasets; see https://apify.com/thoob/osha-enforcement-feed.md for dataset ids). Filter to California and San Diego County. VERIFY rate limits.

Build as manual-CSV-drop adapters first, automate only after Joe confirms terms or buys access:

* California Secretary of State entities. Bulk Master Unload file ordered through bizfile (about $100; field list VERIFY, see https://www.sos.ca.gov/administration/public-records-act-requests/business-entity-records) or the SOS API at calicodev.sos.ca.gov with a subscription key (third-party guide: https://blog.cobaltintelligence.com/post/guide-to-the-california-secretary-of-state-api-developer-portal). Never scrape the bizfile site.
* Secretary of State UCC filings, tax liens and judgment liens (UCC Connect, https://www.sos.ca.gov/business-programs/ucc). No bulk or API confirmed. Ask Joe to order a bulk extract or confirm terms.
* San Diego County fictitious business names (Acclaim portal linked from https://www.sdarcc.gov/content/arcc/home/divisions/recorder-clerk/fictitious-business-name.html). Terms and export options VERIFY; manual weekly export to start.
* Labor Commissioner judgments, wage claims, public works debarment and DLSE registrations (Salesforce portals linked from https://www.dir.ca.gov/dlse/DLSE-Databases.htm; debarment list at https://www.dir.ca.gov/dlse/debar.html). No export, 5,000-row cap; weekly manual export to start.
* San Diego County Recorder grantor-grantee index (https://www.sdarcc.gov/content/arcc/home/divisions/recorder-clerk/recording.html) and the auditor delinquent tax file ($86, https://www.sandiegocounty.gov/content/sdc/auditor/trdf.html). Manual to start.

Never: `sdcourt.ca.gov`, Yelp, Indeed, LinkedIn, Google search results.

### 4.5 Email

Resend from `mail.joewaltman.com` with SPF, DKIM and DMARC verified before any send. Text-first templates with at most one table. List-Unsubscribe headers, a footer with the physical address, a "why you got this" line, an unsubscribe link and a "forward to a colleague" line. Double opt-in for every new subscriber. The suppression list is honored by every send path. A dry-run mode renders every email to HTML files instead of sending.

### 4.6 Admin (`/admin`, Joe only)

Subscribers with role, answers, partner and last open; a hand-raises inbox; partners with signup counts; job runs with failures; a pre-run helper page per tool (Sections 5 to 8); CSV export of everything.

## 5. Tool 1: New Business Radar (`/newbizradar`), Phase 1

Users: CPAs, bankers, insurance agents, payroll and merchant services reps, commercial printers, sign shops, IT providers, commercial real estate brokers. Joe is also a user.

Pages:

* Landing: one sentence on what it is, a live sample digest for one ZIP cluster rendered from real data and updated weekly (indexable), who it is for, signup.
* Signup: email, name, company, role, ZIP clusters (multi-select), categories (multi-select), frequency (weekly only at launch). Two qualifying questions: "What do you sell to new businesses?" and "How many clients do you serve?" (bands). A partner slug is captured from `?partner=`.
* Public weekly pages, one per cluster (for example `/newbizradar/north-county-coastal`), showing last week's list with name, type and city only. These are the search surface.
* Co-branded landing at `/newbizradar/p/[partner-slug]` with the partner's name and logo and a "shared with you by" line.

The digest (Monday 6:00am PT), filtered to each subscriber's clusters and categories:

* New businesses: name, DBA, category, city and ZIP, sources, date first seen, website if found, one-line note.
* Liquor license activity: new applications, transfers (from and to), escrow, for bars and restaurants.
* Capital events: new SBA loans over $250,000 (borrower, lender, amount band, city).
* New licenses: contractors and professionals by type.
* A CSV link, and a line: "Reply with a name you want more on." Replies go to Joe.

Rules: dedupe one entity across sources into one row that lists all its sources; show city and ZIP only, never a home address, for sole proprietors; send a two-line "quiet week" note rather than an empty digest.

Hand-raise at the bottom: "Want this piped into your CRM with enrichment and follow-up sequences? Reply or click."

Done when: a real North County coastal digest reaches Joe from live data for two consecutive Mondays; three partner pages exist; signup, double opt-in, unsubscribe and CSV export work; every parser has a fixture test.

## 6. Tool 2: Tariff Refund Tool (`/tariffrefund`), Phase 2, about one week

Users: small importers (Amazon sellers, furniture and cabinet dealers, contractors who buy cabinets, machine shops buying metal) and the customs brokers who will share it. The window closes around February 2027, which is why it comes before the Watchlist.

Part A, refund path finder (ten questions, no account needed):

1. Did you import goods into the US between February 1, 2025 and February 19, 2026?
2. Were duties paid under the IEEPA tariffs (the 2025 border or "fentanyl" tariffs on Canada, Mexico and China, or the "reciprocal" tariffs)? Yes, no, not sure. The "not sure" branch explains how to tell from the CBP Form 7501 or the broker invoice (Chapter 99 duty lines).
3. Who was the importer of record? You; your customs broker in your name; a courier (UPS, FedEx, DHL) on delivered-duty-paid terms; not sure.
4. Do you or your broker have ACE portal access?
5. Entry status: unliquidated; liquidated within the last 180 days; finally liquidated; not sure.
6. Did you file a protest, file a Court of International Trade suit, or provide your importer number to CIT counsel by July 30, 2026?
7. Is ACH refund information on file with CBP?
8. Roughly how much IEEPA duty did you pay? (bands)
9. Which broker or brokers filed your entries? (free text, used to route the handoff)
10. Email for the result.

Output: the path that applies (CAPE through your broker; protest; the CIT class in Freestyle World v. CBP certified October 8, 2026; the courier's own refund process; or "likely no refund path, and here is why"), the deadline that applies (a two-year limitations period from the date of deposit, so entries from early 2025 start expiring around February 2027), the documents to gather, and a "send this to your broker" summary. Shown on screen and emailed. The decision tree lives in `content/tariff-rules.json` with the facts and sources from Appendix A. VERIFY items appear in the admin view, never in user copy.

Part B, landed-cost calculator. Inputs: HTS code or a product category from a short picklist (upholstered furniture, kitchen cabinets and vanities, lumber, steel articles, aluminum articles, copper, auto parts, trucks and parts, semiconductors, general goods), country of origin, declared value, shipments per month. Output: the duty stack today (MFN base rate from the USITC Harmonized Tariff Schedule export, Section 301 forced-labor rate of 10% or 12.5% by country with the USMCA and Section 232 exemptions, the applicable Section 232 rate) against January 1, 2027 (upholstered furniture, kitchen cabinets and vanities step up to 30% and 50%), plus the per-entry cost now that de minimis is suspended (minimum merchandise processing fee $26.79 plus a broker fee range). Rates and country lists live in `content/tariff-rules.json` with the as-of date shown on the page. Pull base rates from the USITC HTS data export at https://hts.usitc.gov/ (VERIFY the current CSV or JSON endpoint) and cache them.

Lead capture and partner routing: the result email; an optional "ask a broker to review" button that sends the summary to the partner broker on file (partners table) with the user's consent; one qualifying question, annual import value band.

Admin pre-run helper: paste an importer name; the page links to an ImportYeti search (https://www.importyeti.com/, terms VERIFY before any automation) and stores Joe's note.

Done when: the questionnaire produces the expected path for eight scenario fixtures in tests; the rules JSON carries sources and dates; the calculator reproduces three hand-computed examples; Joe's broker partner has reviewed the copy.

## 7. Tool 3: Customer Watchlist (`/watchlist`), Phase 3

Users: owners and controllers at distributors, manufacturers, subcontractors and staffing firms that extend trade credit.

Flow:

* Magic-link signup with company, role, revenue band, industry, AR size band.
* Add up to 25 customers: paste names or upload a CSV (name; city or state optional). Entity resolution runs; the user confirms matches (show the SOS number, address and license numbers); unmatched names stay as name-only watches.
* Weekly Monday email and a dashboard: per customer, new events since last week with severity and a one-line plain-English note. "Nothing new" is a two-line email.

Events from the spine: SOS status changes (suspended, forfeited, dissolved, new statement of information); UCC filings and tax or judgment liens once the UCC adapter is live; CSLB and DCA license status, bond cancellation, workers comp indicator changes; Labor Commissioner judgments and debarment; federal bankruptcy and civil cases from CourtListener; ABC status changes for bar and restaurant customers; OSHA inspections (info severity, optional).

Rules: entity-level only, never individuals; no scores or risk ratings, only dated public events with the source record linked; the user can mute an event type and it stays muted.

Hand-raise: "Want credit holds and collections sequences wired into your ERP or QuickBooks? Click."

Done when: five pilot accounts (Joe supplies them) receive two weekly emails from live data; the match confirmation UI works; every event links to its source; muting works.

## 8. Tool 4: California AI-at-Work Checker (`/aiwork`), Phase 4, launch by March 2027

Users: owners and GMs at California employers with five or more employees, reached through employment attorneys, HR consultants and PEOs.

Questionnaire (no account; email for the result):

1. Employees in California: under 5, 5 to 24, 25 to 74, 75 to 99, 100 or more.
2. Applicant tracking system or job-board screening in use: Workable, Greenhouse, Lever, iCIMS, BambooHR, Workday, ADP, Paycor, Paylocity, Gusto, Indeed-hosted, other, none.
3. Any AI or automated screening of resumes, video interviews, assessments or targeted job ads?
4. Scheduling software that assigns shifts or hours automatically?
5. Productivity, keystroke, location or camera monitoring of employees?
6. Any tool that infers emotional state or collects neural or biometric data?
7. Any surveillance in bathrooms, locker rooms or similar spaces?
8. Any automated input into discipline, termination, promotion or pay decisions?
9. Do you collect consumers' personal information, with revenue over $26.6 million or data on 100,000 or more consumers?
10. Do you use AI-generated content in employee communications or notices?

Rules engine, `content/aiwork-rules.json`, versioned, each rule with sources and an as-of date:

* Civil Rights Council automated decision system regulations under FEHA, effective October 1, 2025: broad ADS definition (resume screeners, targeted ads, game-based assessments), four-year recordkeeping including ADS data, vendor and agent liability.
* CPPA automated decision-making technology regulations: compliance by January 1, 2027 for significant decisions including employment (pre-use notice, opt-out and access rights, risk assessments), applicable only where the CCPA applies.
* SB 947 (No Robo Bosses Act), effective July 1, 2027: no sole reliance on an ADS for discipline or termination, human corroboration, written notice, a data description on request, $500 per violation. Size threshold VERIFY.
* AB 1883: bans AI surveillance that infers emotional state or collects neural data. AB 1331: bans bathroom surveillance.
* SB 951: Cal-WARN notices must include a technology displacement statement when AI drives a layoff (75-plus employee facilities).

Output: a dated obligations list ("by January 1, 2027: ...", "by July 1, 2027: ..."), what to do for each (notice, recordkeeping, a human review step, a vendor contract clause), and notice templates to download. A clear line at the top: this is an information tool, not legal advice, reviewed by [partner attorney] as of [date]. Shown on screen and emailed.

Co-branding at `/aiwork/p/[partner-slug]` for attorneys and HR consultants, with their name and a "book a review" link that goes to them.

Admin pre-run helper: paste a company's careers page URL; detect the ATS vendor from URL patterns and page markers; store a one-line note for outreach.

Hand-raise: "Want help choosing or implementing AI tools that stay inside these rules? Click."

Done when: the rules JSON has been reviewed by an attorney (Joe arranges it); ten scenario fixtures produce the expected obligations; partner pages work; templates download.

## 9. Phases and order

* Phase 0 (weeks 1 to 2): discovery, scaffold, spine (schema, the three easiest approved adapters: city business tax, ABC, CSLB), email on the subdomain, admin skeleton, legal pages.
* Phase 1 (weeks 2 to 4): New Business Radar, live digest to Joe, then to partners.
* Phase 2 (week 5): Tariff Refund Tool. It is a rules tool rather than a data build, and its window closes around February 2027.
* Phase 3 (weeks 6 to 9): Customer Watchlist on the spine, adding CourtListener, DCA diffs and the manual-drop adapters for UCC, Labor Commissioner and the recorder.
* Phase 4 (by March 2027): AI-at-Work Checker, after attorney review of the rules file.

## 10. Testing and quality bar

* A fixture test for every parser, using a real sample file per source, committed, with PII-free rows.
* Scenario tests for both rules engines (tariff paths, AI-at-work obligations).
* Dry-run mode for every email job.
* Lighthouse mobile score above 90 on every landing page.
* A runbook in `docs/` per tool: how to refresh the rules file, how to replace a manual CSV drop, what to do when a source changes its format.

## 11. CLAUDE.md starter (create at the repo root)

```
- Copy rule: plain English, no em dashes anywhere (code comments and emails included), no hype words.
- Ask before: spending money, sending email to anyone but Joe, scraping a new source, changing DNS.
- Never scrape bizfileonline.sos.ca.gov, sdcourt.ca.gov, Yelp, Indeed, LinkedIn or Google results.
- Legal and rate facts live in content/*.json with source URLs and as-of dates; never hardcode them in components.
- Entity-level public data only; no individuals, no scores.
- Every ingestion job: idempotent, archived raw file, job_runs row, failure email to Joe.
- Run the parser and rules tests before every commit.
```

## Appendix A: verified facts and sources (as of October 16, 2026)

### Tariffs

* Supreme Court, Learning Resources v. Trump, February 20, 2026: IEEPA does not authorize tariffs. https://www.bradley.com/insights/publications/2026/02/supreme-court-strikes-down-ieepa-tariffs-key-takeaways-and-next-steps-for-businesses/
* Court of International Trade (Atmus Filtration, March 4, 2026) ordered refunds with interest on unliquidated and non-final entries for all importers of record. https://www.bakerlaw.com/insights/court-of-international-trade-orders-refund-of-ieepa-duties-and-interest-following-supreme-court-decision/
* CBP CAPE phases: April 20, 2026 (unliquidated entries and entries within 80 days of liquidation); June 29, 2026 (reconciliation-flagged entries); October 6, 2026 (finally liquidated entries, only for CIT plaintiffs who provided an importer number by July 30, 2026). About $126 billion transmitted to Treasury; $1.1 billion held for missing ACH bank details. Refunds are ACH only since February 6, 2026. https://www.bakertilly.com/insights/ieepa-refunds and https://www.chrobinson.com/en-au/resources/insights-and-advisories/client-advisories/2026q3/09-17-26-cbp-cape-phase-3-ieepa-refunds/
* Two-year limitations period from the date of deposit for CIT suits; early-2025 entries expire around February 2027. https://www.troutman.com/insights/to-sue-or-not-to-sue-that-is-the-question-for-ieepa-tariff-refunds/
* Class certified October 8, 2026 in Freestyle World v. CBP for importers of record who paid IEEPA duties February 1, 2025 to February 19, 2026 and did not separately sue; certification does not yet order refunds; schedule due October 22, 2026. https://www.bakertilly.com/insights/ieepa-refunds
* DDP courier shipments: the courier is the importer of record and the merchant has no filing standing. https://gingercontrol.com/blog/ddp-shipments-courier-ior-ieepa-refund
* Section 301 forced-labor tariffs effective July 24, 2026: 10% (Canada, Mexico, EU, UK, India, Indonesia, Malaysia, Taiwan and others) or 12.5% (China, Vietnam, Thailand, Japan, Korea, Brazil and 40-plus others); exemptions for USMCA-compliant goods and goods already under Section 232; argued at the CIT September 30, 2026, no ruling yet. https://www.akerman.com/en/perspectives/section-301-forced-labor-tariffs-set-to-cover-most-imports-into-the-u-s-starting.html and https://clarkhill.com/news-events/news/ustr-section-301-forced-labor-tariffs-2026/
* Section 232: steel, aluminum and copper at 50% on articles and 25 to 50% on derivatives since April 6, 2026; autos and parts 25%; medium and heavy trucks and parts 25%, buses 10%; timber and lumber 10%; upholstered furniture, kitchen cabinets and vanities 25% now, rising to 30% and 50% on January 1, 2027 under Proclamation 11000. https://www.cov.com/en/news-and-insights/insights/2026/04/current-and-forthcoming-section-232-actions-by-the-trump-administration and https://www.federalregister.gov/citation/91-FR-1039
* De minimis suspended for all countries since August 29, 2025, anchored by interim final rules published June 24, 2026; statutory repeal July 1, 2027. https://www.federalregister.gov/documents/2026/06/24/2026-12670/indefinite-suspension-of-the-de-minimis-exemption-for-merchandise-arriving-through-all-modes-other
* Minimum merchandise processing fee $26.79 per entry plus a broker fee per entry. https://beancount.io/blog/2026/08/13/end-800-de-minimis-exemption-small-importer-2026-guide
* Existing free calculators to differentiate from: Flexport (https://www.businesswire.com/news/home/20260120812295/en/Flexport-Launches-Tariff-Refund-Calculator-Giving-Businesses-Early-Insight-Into-Possible-Tariff-Refunds) and Wove (https://wove.com/blog/ieepa-tariff-refund-calculator), both upload-your-entries tools.

### AI at work

* Civil Rights Council ADS regulations effective October 1, 2025. https://www.paulhastings.com/insights/client-alerts/new-california-regulations-on-employers-use-of-ai-to-make-decisions-go-into-effect-oct-1-2025
* CPPA ADMT rules: compliance by January 1, 2027; risk assessments from January 1, 2026 with first submissions April 1, 2028. https://www.whitecase.com/insight-alert/cppa-finalizes-rules-admt-risk-assessments-and-cybersecurity-audits-requirements
* SB 947, SB 951, AB 1883 and AB 1331 signed September 30, 2026; SB 947 effective July 1, 2027. https://www.ebglaw.com/insights/publications/four-new-california-laws-reshape-the-rules-for-workplace-ai and https://www.coblentzlaw.com/news/californias-new-employment-laws-for-2027-what-employers-need-to-know-and-do/
* CCPA thresholds: $26,625,000 revenue or 100,000 consumers; next adjustment January 2027. https://cppa.ca.gov/announcements/2024/20241217.html
* California minimum wage $17.40 and exempt salary floor $72,384 on January 1, 2027. https://www.dir.ca.gov/DIRNews/2026/2026-66.html

### Outreach and data-use constraints

* CAN-SPAM applies to B2B mail, up to $53,088 per email. https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
* California B&P 17529.5: $1,000 per email for misleading headers or subjects. https://california.public.law/codes/ca_bus_and_prof_code_section_17529.5
* FTC on FCRA: reports on business entities are not consumer reports; reports on owners or guarantors generally lack a permissible purpose. https://www.ftc.gov/node/33876
* bizfile terms: no scrapers, no commercial use of site content; filing data itself is public. https://www.sos.ca.gov/business-programs/bizfile/privacy-warning-terms-and-conditions-use
* San Diego Superior Court terms prohibit bots and data mining. https://www.sdcourt.ca.gov/sdcourt/termsofuse
