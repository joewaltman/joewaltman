import { and, count, desc, entityEvents, eq, getDb, gte, inArray, isNull, subscribers, subscriptions, watchlistItems, watchlists } from "@jw/db";
import { WATCH_EVENT_TYPES, entityCards, findMatches, watchNote } from "@jw/pipeline/watchlist";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";

const TEST_MESSAGES: Record<string, string> = {
  sent: "Test email sent to you.",
  dryrun: "EMAIL_MODE is dryrun, so the test email was written to a file instead.",
  failed: "The test email failed. See Emails for the error.",
  empty: "That list has no customers yet, so there is nothing to send.",
};

export default async function AdminWatchlistPage({ searchParams }: { searchParams: Promise<{ name?: string; city?: string; test?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const db = getDb();
  const [lists, statuses] = await Promise.all([
    db
      .select({
        id: watchlists.id,
        email: subscribers.email,
        company: subscribers.company,
        revenueBand: subscribers.revenueBand,
        preferences: subscriptions.preferences,
        active: subscriptions.active,
        lastSentAt: watchlists.lastSentAt,
        createdAt: watchlists.createdAt,
      })
      .from(watchlists)
      .innerJoin(subscribers, eq(watchlists.subscriberId, subscribers.id))
      .leftJoin(subscriptions, and(eq(subscriptions.subscriberId, subscribers.id), eq(subscriptions.tool, "watchlist")))
      .orderBy(desc(watchlists.createdAt)),
    db
      .select({ watchlistId: watchlistItems.watchlistId, status: watchlistItems.matchStatus, n: count() })
      .from(watchlistItems)
      .where(isNull(watchlistItems.removedAt))
      .groupBy(watchlistItems.watchlistId, watchlistItems.matchStatus),
  ]);
  const tally = (id: string, status: string) => statuses.find((s) => s.watchlistId === id && s.status === status)?.n ?? 0;

  // Pre-run helper: what a name would match, and what the records already say about the matches.
  const name = q.name?.trim();
  const matches = name ? await findMatches(db, { name, city: q.city?.trim() || null }) : [];
  const cards = await entityCards(db, matches.map((m) => m.entityId));
  const events =
    matches.length > 0
      ? await db
          .select()
          .from(entityEvents)
          .where(
            and(
              inArray(entityEvents.entityId, matches.map((m) => m.entityId)),
              inArray(entityEvents.eventType, WATCH_EVENT_TYPES),
              gte(entityEvents.createdAt, new Date(Date.now() - 365 * 86_400_000)),
            ),
          )
          .orderBy(desc(entityEvents.createdAt))
      : [];

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">Customer Watchlist</h1>
      <p className="mb-8 text-muted">
        {lists.length} {lists.length === 1 ? "list" : "lists"}. The weekly email goes out Mondays at 6:15am Pacific; court
        searches run daily at 5:50am.
      </p>
      {q.test && TEST_MESSAGES[q.test] ? <p className="notice">{TEST_MESSAGES[q.test]}</p> : null}

      <h2 className="mb-3 text-[1.2rem] font-semibold">Lists</h2>
      <DataTable
        rows={lists.map((l) => {
          const p = (l.preferences ?? {}) as { jobRole?: string; industry?: string; arBand?: string };
          return {
            id: l.id,
            createdAt: l.createdAt,
            email: l.email,
            company: l.company ?? "",
            about: [p.jobRole, p.industry, l.revenueBand, p.arBand ? `AR ${p.arBand}` : null].filter(Boolean).join(", "),
            status: l.active ? "confirmed" : "pending",
            customers: `${tally(l.id, "confirmed")} matched, ${tally(l.id, "needs_review")} to pick, ${tally(l.id, "name_only")} name only`,
            lastSentAt: l.lastSentAt ?? "",
          };
        })}
        empty="No lists yet."
        columns={[
          { key: "createdAt", label: "Started" },
          { key: "email", label: "Email" },
          { key: "company", label: "Company" },
          { key: "about", label: "Role, industry, size" },
          { key: "status", label: "Status" },
          { key: "customers", label: "Customers" },
          { key: "lastSentAt", label: "Last email" },
          {
            key: "id",
            label: "",
            render: (r) => (
              <form method="post" action="/api/forms/admin-watchlist-test">
                <input type="hidden" name="watchlist" value={String(r.id)} />
                <button type="submit" className="cursor-pointer text-accent underline">
                  Email me this week&apos;s
                </button>
              </form>
            ),
          },
        ]}
      />

      <h2 className="mt-10 mb-2 text-[1.2rem] font-semibold">Pre-run helper</h2>
      <p className="mb-3 text-[0.95rem] text-muted">
        Check how a pilot&apos;s customer would match before they sign up, and what the records already show.
      </p>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Customer name</span>
          <input className="field" name="name" defaultValue={name ?? ""} required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">City</span>
          <input className="field" name="city" defaultValue={q.city ?? ""} />
        </label>
        <button type="submit" className="btn">
          Look up
        </button>
      </form>
      {name ? (
        matches.length === 0 ? (
          <p>No public record matched. On a list this would be watched by name in court records if it is a registered entity.</p>
        ) : (
          <ul className="grid gap-3 pl-5 text-[0.95rem]">
            {matches.map((m) => {
              const c = cards.get(m.entityId)!;
              const evs = events.filter((e) => e.entityId === m.entityId);
              return (
                <li key={m.entityId}>
                  <strong>{c.dba ? `${c.dba} (${c.name})` : c.name}</strong>, {[c.address, c.city, c.zip].filter(Boolean).join(", ")}{" "}
                  <span className="text-muted">
                    match {m.confidence.toFixed(2)}
                    {m.confidence >= 0.9 ? ", taken without asking if no other look-alike is as close" : ", the user picks"}
                  </span>
                  <div className="text-muted">{c.identifiers.join("; ")}</div>
                  {evs.map((e) => (
                    <div key={e.id}>
                      {e.eventDate ?? e.createdAt.toISOString().slice(0, 10)}: {watchNote(e)}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
