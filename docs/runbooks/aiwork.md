# California AI-at-Work Checker runbook

Public pages: `/aiwork` (landing, and the questionnaire once open), `/aiwork/p/[slug]` (attorney or HR partner co-brand), `/aiwork/result/[id]`, `/aiwork/templates/[id]` (plain-text notice templates), `/aiwork/help` (hand-raise). Admin: `/admin/aiwork`.

## Where the rules live

Everything is in `content/aiwork-rules.json`; the engine is `packages/content/src/aiwork/`.

- `facts`: each statement with `sources`, `asOf` and `verify`. Where the sources leave a point open, the fact carries an `assumption`: the judgment call, shown to visitors as a numbered footnote wherever their result relies on it. A fact marked `verify: true` is held back from visitors, along with any obligation or template resting on it.
- `questions`: the spec's ten questions plus an optional email.
- `laws`: the six rules checked, each with its effective date.
- `obligations`: what the result lists. Each one names its law and kind (`dated`, `check`, `conditional`, `practice`), the facts it rests on, when it applies (`whenAny`, with `unless` exceptions), what it says, what to do, the note shown when it matched only through a "not sure" answer, and its templates.
- `templates`: the notice and contract text offered as downloads.
- `review`: who reviewed the rules and when.

## Launched without attorney review

On October 17, 2026 Joe chose to launch without an employment attorney's review (`review.launchedWithoutReview` in the rules file). Every result and template says at the top that it is information, not legal advice, and has not been reviewed by an attorney, and lists its sources and numbered assumptions at the bottom.

The statements rest on the Civil Rights Council regulations as summarized by Paul Hastings, the CPPA's approved regulation text, the Civil Rights Department's employment page, and Epstein Becker Green and Coblentz summaries of the four 2026 laws. The eight judgment calls are listed on `/admin/aiwork` under "Assumptions in use".

To change a judgment call, edit its fact's `assumption` (or the fact itself) and deploy. If an attorney or partner reviews the rules later, download the plain-text rules from `/admin/aiwork`, apply their corrections, fill in `review.reviewedBy` and `review.reviewedOn`, and results will say "Reviewed by" instead.

## Changing the rules later

Edit the JSON, bump `version` and `asOf`, and add or update a scenario in `packages/content/src/aiwork/scenarios.test.ts`. The tests fail on a reference to an unknown fact, law, question, answer or template, on an em dash, on a fact in use without a source, or when the list of assumptions changes without the test changing too. Stored results keep the version they were made with.

## Partners

Add a partner in `/admin/partners` with tool `aiwork` and a booking link. Their page is `/aiwork/p/<slug>`, and results started there show a "Book a review with <name>" button that goes to the booking link (or their contact email).

## Pre-run helper

On `/admin/aiwork`, paste a company's careers page. The page is read once (10 second limit) and the applicant tracking system is named from the URL or the page's embeds, then saved with your note.
