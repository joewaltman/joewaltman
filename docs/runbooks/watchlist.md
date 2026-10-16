# Customer Watchlist runbook

Public pages: `/watchlist` (landing and signup), `/watchlist/p/[slug]` (partner co-brand), `/watchlist/sign-in`, `/watchlist/list` (the signed-in page: matches to pick, recent records, customers, muting), `/watchlist/erp` (where the email's "click here" lands). Admin: `/admin/watchlist`.

## How a customer gets watched

1. Someone signs up with company, role, industry and size. The confirmation link also signs them in.
2. They paste names or upload a CSV (up to 25). Each name is matched against the entities the pipeline has collected, by legal name and trade name, with a nudge for a matching city.
3. A match at 0.9 or above is taken without asking unless a second look-alike is just as close. Anything from 0.75 up is listed for the person to pick, with the address and license or account numbers. Below that, the name is watched by name only.
4. A name-only customer that reads as a registered entity (LLC, Inc., Corp., LP) gets a watch-only entity (source `watchlist`) so court searches have something to attach to. Watch-only entities are never offered as matches to anyone.

## Events

The kinds shown are listed in `packages/pipeline/src/watchlist/events.ts` (`WATCH_EVENTS`), with the plain-English wording for each. People can mute a kind; it stays muted until they turn it back on. Every event links to its source record.

## Court records (CourtListener)

The `courtlistener` job runs daily at 5:50am Pacific. For each registered entity on any list it searches federal dockets by party name: a year back the first time, then from two weeks before the last search. A docket counts only when a party's name normalizes to exactly the customer's name. The job stores the court, case number, filing date, nature of suit and the customer's role (debtor, plaintiff, defendant, party), never the other parties' names. Sole proprietors and unregistered names are never searched, so no one's personal bankruptcy shows up.

It works without a key at low volume. For CourtListener's higher authenticated limits, create a free account at courtlistener.com, copy the API token from your profile, and set `COURTLISTENER_API_TOKEN` on the Railway `pipeline` service. The job's run record says whether it ran authenticated.

## The Monday email

The `watchlist-digest` job runs Mondays at 6:15am Pacific, after the court search and the morning ingestion. Each confirmed list gets the records found since its last email, worst first; a quiet week is two lines. A retry the same week skips lists already sent.

## Checking before Monday

On `/admin/watchlist`, "Email me this week's" sends any list's email to `ADMIN_EMAIL`. The pre-run helper shows how a name would match and what the records already hold, before a pilot signs up.
