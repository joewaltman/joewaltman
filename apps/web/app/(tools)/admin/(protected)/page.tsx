import {
  count,
  desc,
  emailSends,
  eq,
  getDb,
  handRaises,
  isNull,
  jobRuns,
  subscribers,
  subscriptions,
} from "@jw/db";
import { loadEmailConfig } from "@jw/email";
import Link from "next/link";
import { requireAdmin } from "@/lib/server";
import { EXPORT_TABLES } from "../export/[table]/tables";

export default async function AdminOverview() {
  await requireAdmin();
  const db = getDb();
  const [[subs], [active], [openRaises], [failedJobs], recentEmails] = await Promise.all([
    db.select({ n: count() }).from(subscribers),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.active, true)),
    db.select({ n: count() }).from(handRaises).where(isNull(handRaises.handledAt)),
    db.select({ n: count() }).from(jobRuns).where(eq(jobRuns.status, "failed")),
    db.select().from(emailSends).orderBy(desc(emailSends.createdAt)).limit(1),
  ]);
  const config = loadEmailConfig();

  const stats: Array<[string, number | string, string]> = [
    ["Open hand-raises", openRaises?.n ?? 0, "/admin/hand-raises"],
    ["Subscribers", subs?.n ?? 0, "/admin/subscribers"],
    ["Active subscriptions", active?.n ?? 0, "/admin/subscribers"],
    ["Failed job runs", failedJobs?.n ?? 0, "/admin/jobs"],
  ];

  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Overview</h1>
      <ul className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(([label, value, href]) => (
          <li key={label} className="border border-rule p-3">
            <Link href={href} className="text-ink no-underline">
              <div className="text-[1.6rem] font-semibold tabular-nums">{value}</div>
              <div className="text-[0.85rem] text-muted">{label}</div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[0.95rem]">
        Email mode: <strong>{config.mode}</strong>. Postal address{" "}
        {config.postalAddress ? "is set" : <strong>is not set</strong>}. Last email logged:{" "}
        {recentEmails[0] ? recentEmails[0].createdAt.toISOString().slice(0, 16) : "none"}.
      </p>
      <h2 className="mt-8 mb-2 font-semibold">CSV export</h2>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.95rem]">
        {EXPORT_TABLES.map((t) => (
          <a key={t} href={`/admin/export/${t}`}>
            {t}
          </a>
        ))}
      </p>
    </div>
  );
}
