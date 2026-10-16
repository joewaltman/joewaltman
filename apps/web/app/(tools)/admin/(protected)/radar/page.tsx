import { taxonomy, zipClusters } from "@jw/content";
import { and, desc, eq, getDb, isNull, subscribers, subscriptions } from "@jw/db";
import { areasLabel, buildDigest, clusterLabel, digestEmailSections, digestSize, digestWindow, weekLabel } from "@jw/radar";
import { DataTable } from "@/components/data-table";
import { adminCsvPath, pickAreas } from "@/lib/radar-admin";
import { requireAdmin } from "@/lib/server";

const box = "size-4 accent-[#1f4a6b]";
const TEST_MESSAGES: Record<string, string> = {
  sent: "Test digest sent. Check your inbox.",
  dryrun: "EMAIL_MODE is dryrun, so the test digest was written to a file instead of sent.",
  failed: "The test digest failed to send. See Emails for the error.",
  blocked: "The test digest was blocked by EMAIL_MODE.",
  suppressed: "Your address is on the suppression list, so nothing was sent.",
};

export default async function AdminRadarPage({
  searchParams,
}: {
  searchParams: Promise<{ areas?: string | string[]; test?: string }>;
}) {
  await requireAdmin();
  const { areas, test } = await searchParams;
  const clusters = pickAreas(typeof areas === "string" ? [areas] : (areas ?? []));
  const db = getDb();
  const window = digestWindow(new Date());
  const [digest, subs] = await Promise.all([
    buildDigest(db, { ...window, clusters }),
    db
      .select({
        email: subscribers.email,
        company: subscribers.company,
        role: subscribers.role,
        active: subscriptions.active,
        preferences: subscriptions.preferences,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .innerJoin(subscribers, eq(subscriptions.subscriberId, subscribers.id))
      .where(and(eq(subscriptions.tool, "radar"), isNull(subscribers.unsubscribedAt)))
      .orderBy(desc(subscriptions.createdAt)),
  ]);
  const sections = digestEmailSections(digest);
  const categoryNames = new Map(taxonomy.categories.map((c) => [c.id, c.label]));
  const confirmed = subs.filter((s) => s.active).length;

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">New Business Radar</h1>
      <p className="mb-8 text-muted">
        {confirmed} confirmed {confirmed === 1 ? "subscriber" : "subscribers"}, {subs.length - confirmed} pending.
        The digest goes out Mondays at 6:00am Pacific for the week before.
      </p>

      <h2 className="mb-2 text-[1.2rem] font-semibold">Digest preview</h2>
      {test && TEST_MESSAGES[test] ? <p className="notice">{TEST_MESSAGES[test]}</p> : null}
      <form method="get" className="mb-4 grid gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.95rem]">
          {Object.entries(zipClusters.clusters).map(([id, c]) => (
            <label key={id} className="flex items-center gap-2">
              <input className={box} type="checkbox" name="areas" value={id} defaultChecked={clusters.includes(id)} />
              {c.label}
            </label>
          ))}
        </div>
        <div>
          <button type="submit" className="btn">
            Show preview
          </button>
        </div>
      </form>
      <form method="post" action="/api/forms/admin-radar-test" className="mb-6 flex flex-wrap items-center gap-4">
        {clusters.map((c) => (
          <input key={c} type="hidden" name="areas" value={c} />
        ))}
        <button type="submit" className="btn">
          Email me this digest
        </button>
        <a href={adminCsvPath(clusters)}>Download the CSV</a>
      </form>

      <div className="mb-10 max-w-2xl border border-rule p-4 text-[0.95rem]">
        <p className="mt-0 font-semibold">
          {digestSize(digest) === 0
            ? `New Business Radar: a quiet week in ${areasLabel(clusters)}`
            : `${weekLabel(window.start, window.end)}, ${areasLabel(clusters)}`}
        </p>
        {sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <div key={s.title}>
              <p className="mb-1 font-semibold">
                {s.title} ({s.items.length + s.more})
              </p>
              <ul className="mt-0 grid gap-1.5 pl-5">
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {s.more > 0 ? <p className="text-muted">And {s.more} more in the CSV.</p> : null}
            </div>
          ))}
        {digestSize(digest) === 0 ? <p className="mb-0 text-muted">Nothing new in these areas last week.</p> : null}
      </div>

      <h2 className="mb-3 text-[1.2rem] font-semibold">Subscribers</h2>
      <DataTable
        rows={subs.map((s) => {
          const p = s.preferences as { zipClusters?: string[]; categories?: string[]; sells?: string | null; clientsBand?: string | null };
          return {
            createdAt: s.createdAt,
            email: s.email,
            company: s.company ?? "",
            role: s.role ?? "",
            status: s.active ? "confirmed" : "pending",
            areas: (p.zipClusters ?? []).map(clusterLabel).join(", "),
            categories: (p.categories ?? []).map((c) => categoryNames.get(c) ?? c).join(", ") || "All",
            sells: p.sells ?? "",
            clients: p.clientsBand ?? "",
          };
        })}
        empty="No Radar subscribers yet."
        columns={[
          { key: "createdAt", label: "Signed up" },
          { key: "email", label: "Email" },
          { key: "company", label: "Company" },
          { key: "role", label: "Role" },
          { key: "status", label: "Status" },
          { key: "areas", label: "Areas" },
          { key: "categories", label: "Kinds" },
          { key: "sells", label: "Sells" },
          { key: "clients", label: "Clients" },
        ]}
      />
    </div>
  );
}
