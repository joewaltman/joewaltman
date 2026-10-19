// Run by src/email-under-tsx.test.ts through tsx, the way the Railway pipeline runs, to prove the
// email package's JSX compiles and renders there (Vitest compiles JSX differently).
import { tmpdir } from "node:os";
import { createTestDb } from "@jw/db/testing";
import { jobFailed, radarDigest, sendEmail, watchlistDigest } from "@jw/email";

const db = await createTestDb();
const config = { mode: "dryrun" as const, adminEmail: "joewaltman@gmail.com", from: "Joe Waltman <joe@joewaltman.com>", replyTo: "joe@joewaltman.com", siteUrl: "https://joewaltman.com", postalAddress: "PO Box 1", resendApiKey: null, dryRunDir: tmpdir() };
const templates = [
  jobFailed({ job: "x", error: "e", startedAt: "now", attempt: 1, adminUrl: "https://joewaltman.com/admin/jobs" }),
  radarDigest({ areas: "North County coastal", weekLabel: "October 12 to 18, 2026", sections: [{ title: "New businesses", items: ["Example"], more: 0 }], csvUrl: "https://x", wantThisUrl: "https://x" }),
  watchlistDigest({ weekLabel: "October 12 to 18, 2026", totalCustomers: 1, customers: [], needsReview: 0, dashboardUrl: "https://x", wantThisUrl: "https://x" }),
];
for (const template of templates) {
  const result = await sendEmail({ db, config }, { to: "joewaltman@gmail.com", template, reason: "test" });
  if (result.status !== "dryrun") throw new Error(`${template.name}: ${result.status}`);
}
console.log(`rendered ${templates.length}`);
