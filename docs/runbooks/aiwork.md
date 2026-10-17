# California AI-at-Work Checker runbook

Public pages: `/aiwork` (landing, and the questionnaire once open), `/aiwork/p/[slug]` (attorney or HR partner co-brand), `/aiwork/result/[id]`, `/aiwork/templates/[id]` (plain-text notice templates), `/aiwork/help` (hand-raise). Admin: `/admin/aiwork`.

## Where the rules live

Everything is in `content/aiwork-rules.json`; the engine is `packages/content/src/aiwork/`.

- `facts`: each statement with `sources`, `asOf` and `verify`. Only the Appendix A facts from the build spec are confirmed. Every other statement has `verify: true`, with the source it came from and a note on what is uncertain.
- `questions`: the spec's ten questions plus an optional email.
- `laws`: the six rules checked, each with its effective date.
- `obligations`: what the result lists. Each one names its law and kind (`dated`, `check`, `conditional`, `practice`), the facts it rests on, when it applies (`whenAny`, with `unless` exceptions), what it says, what to do, the note shown when it matched only through a "not sure" answer, and its templates.
- `templates`: the notice and contract text offered as downloads.
- `review`: who reviewed the rules and when.

## Launch: the attorney review

The checker is closed to visitors until `review.reviewedBy` and `review.reviewedOn` are filled in. Until then, `/aiwork` shows a signup for a launch note, and you (signed in to admin) see the full questionnaire as a preview. Preview results say they are drafts.

1. Download the review packet from `/admin/aiwork` and send it to the attorney. It lists the questions, every statement with its sources and status, every obligation with when it is shown, and the templates.
2. For each statement the attorney confirms, set `verify` to false (correcting the text if needed). For one they change, update the text and any obligation copy that relies on it.
3. Fill in `review.reviewedBy` (the name shown on results, for example "Jane Smith, Smith Employment Law") and `review.reviewedOn`, bump `version` and `asOf`, run `pnpm test`, commit and deploy.

Visitors only ever see obligations and templates whose statements are all confirmed. An obligation resting on a statement still marked verify is left out of their result, with a line saying some rules are still being confirmed.

## Changing the rules later

Edit the JSON, bump `version` and `asOf`, and add or update a scenario in `packages/content/src/aiwork/scenarios.test.ts`. The tests fail on a reference to an unknown fact, law, question, answer or template, on an em dash, or if a fact outside the confirmed list loses its verify flag without a test change. Stored results keep the version they were made with.

## Partners

Add a partner in `/admin/partners` with tool `aiwork` and a booking link. Their page is `/aiwork/p/<slug>`, and results started there show a "Book a review with <name>" button that goes to the booking link (or their contact email).

## Pre-run helper

On `/admin/aiwork`, paste a company's careers page. The page is read once (10 second limit) and the applicant tracking system is named from the URL or the page's embeds, then saved with your note.
