import { eq, getDb, watchlists } from "@jw/db";
import { type EntityCard, MAX_CUSTOMERS, SEVERITY_LABELS, WATCH_EVENTS, isRegisteredName, mutedTypes, watchlistFeed } from "@jw/pipeline/watchlist";
import type { Metadata } from "next";
import { HandRaise } from "@/components/hand-raise";
import { ERP_PROMPT } from "@/components/watchlist-landing";
import { requireWatcher } from "@/lib/server";

export const metadata: Metadata = { title: "Your Customer Watchlist", robots: { index: false } };

const DAY = 86_400_000;
const box = "mt-1 size-4 shrink-0 accent-[#1f4a6b]";
const ERRORS: Record<string, string> = {
  "file-too-big": "That file is over 200 KB. Upload just the customer names, cities and states.",
  "bad-file": "That file could not be read as a CSV. Save it as CSV from your spreadsheet and try again.",
  empty: "Paste at least one customer name, or choose a CSV file.",
};

function Card({ card }: { card: EntityCard }) {
  const place = [card.address, card.city, card.zip].filter(Boolean).join(", ");
  return (
    <span>
      <strong className="font-semibold">{card.dba ? `${card.dba} (${card.name})` : card.name}</strong>
      {place ? <span className="text-muted">, {place}</span> : null}
      {card.identifiers.length > 0 ? <span className="block text-[0.9rem] text-muted">{card.identifiers.join("; ")}</span> : null}
    </span>
  );
}

function ItemForm({ action, item, label, extra }: { action: string; item: string; label: string; extra?: Record<string, string> }) {
  return (
    <form method="post" action={`/api/forms/${action}`} className="inline">
      <input type="hidden" name="item" value={item} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className="cursor-pointer text-[0.9rem] text-accent underline">
        {label}
      </button>
    </form>
  );
}

export default async function WatchlistListPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; added?: string; full?: string; dupes?: string; error?: string; saved?: string; raised?: string }>;
}) {
  const watcher = await requireWatcher();
  const q = await searchParams;
  const db = getDb();
  const [[list], feed, muted] = await Promise.all([
    db.select({ lastSentAt: watchlists.lastSentAt }).from(watchlists).where(eq(watchlists.id, watcher.watchlistId)),
    watchlistFeed(db, watcher.watchlistId, new Date(Date.now() - 90 * DAY)),
    mutedTypes(db, watcher.watchlistId),
  ]);
  const newSince = list?.lastSentAt ?? new Date(Date.now() - 7 * DAY);
  const review = feed.filter((c) => c.matchStatus === "needs_review");
  const withEvents = feed.filter((c) => c.events.length > 0);
  const room = MAX_CUSTOMERS - feed.length;

  return (
    <div className="prose-plain">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="mb-1 text-[2rem] leading-tight font-semibold">Your Customer Watchlist</h1>
        <form method="post" action="/api/forms/watchlist-sign-out" className="text-[0.95rem]">
          <span className="mr-3 text-muted">{watcher.email}</span>
          <button type="submit" className="cursor-pointer text-accent underline">
            Sign out
          </button>
        </form>
      </div>
      {q.welcome ? <p className="notice">You are confirmed. Add the customers you want to watch below.</p> : null}
      {q.added ? (
        <p className="notice">
          Added {q.added}.{Number(q.dupes) > 0 ? ` ${q.dupes} already on your list.` : ""}
          {Number(q.full) > 0 ? ` ${q.full} left off: the list holds ${MAX_CUSTOMERS}.` : ""}
        </p>
      ) : null}

      {review.length > 0 ? (
        <section id="review">
          <h2>Pick the right match ({review.length})</h2>
          <p className="text-[0.95rem] text-muted">
            These names matched more than one public record, or matched loosely. Pick the business you sell to, or
            none of them.
          </p>
          {review.map((c) => (
            <div key={c.itemId} className="mb-6">
              <p className="mb-2 font-semibold">
                {c.name}
                {c.city ? <span className="font-normal text-muted">, {c.city}</span> : null}
              </p>
              <ul className="m-0 grid list-none gap-2 p-0">
                {c.candidates.map((cand) => (
                  <li key={cand.id} className="flex items-start gap-3">
                    <ItemForm action="watchlist-pick" item={c.itemId} label="This one" extra={{ entity: cand.id }} />
                    <Card card={cand} />
                  </li>
                ))}
                <li>
                  <ItemForm action="watchlist-pick" item={c.itemId} label="None of these" extra={{ entity: "none" }} />
                </li>
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <section id="events">
        <h2>Recent records</h2>
        <p className="text-[0.95rem] text-muted">
          Records found in the last 90 days, each with the date on the record. The first court search for a customer
          looks back a year.
        </p>
        {withEvents.length === 0 ? (
          <p className="text-muted">
            {feed.length === 0 ? "Add customers below to start." : "No public records found on your customers in the last 90 days."}
          </p>
        ) : (
          withEvents.map((c) => (
            <div key={c.itemId} className="mb-5">
              <p className="mb-1 font-semibold">{c.entity && !c.entity.watchOnly ? (c.entity.dba ?? c.entity.name) : c.name}</p>
              <ul className="mt-0 grid gap-1.5 pl-5">
                {c.events.map((e) => (
                  <li key={e.id}>
                    {e.recordedAt > newSince ? <strong className="font-semibold">New. </strong> : null}
                    <span className={e.severity === "serious" ? "font-semibold" : undefined}>{SEVERITY_LABELS[e.severity]}</span>, {e.date}:{" "}
                    {e.note}{" "}
                    {e.sourceUrl ? (
                      <a href={e.sourceUrl} rel="noopener noreferrer" target="_blank">
                        Source
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section id="customers">
        <h2>
          Customers ({feed.length} of {MAX_CUSTOMERS})
        </h2>
        {feed.length === 0 ? <p className="text-muted">None yet.</p> : null}
        <ul className="m-0 grid list-none gap-3 p-0">
          {feed.map((c) => (
            <li key={c.itemId} className="border-b border-rule pb-3">
              <div className="text-[0.95rem] text-muted">
                {c.name}
                {c.city ? `, ${c.city}` : ""}
              </div>
              {c.matchStatus === "confirmed" && c.entity ? (
                <>
                  <Card card={c.entity} />
                  <div className="mt-1 flex gap-4">
                    <ItemForm action="watchlist-reopen" item={c.itemId} label="Not this business" />
                    <ItemForm action="watchlist-remove" item={c.itemId} label="Remove" />
                  </div>
                </>
              ) : (
                <>
                  <span>
                    {c.matchStatus === "needs_review"
                      ? "Waiting for you to pick a match, above."
                      : isRegisteredName(c.name) || c.entity
                        ? "No public license or city record matched. Watched in federal court records by name."
                        : "No public record matched. Court searches run only for registered entities, so add LLC, Inc. or Corp. to the name if it is one."}
                  </span>
                  <div className="mt-1">
                    <ItemForm action="watchlist-remove" item={c.itemId} label="Remove" />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section id="add">
        <h2>Add customers</h2>
        {q.error && ERRORS[q.error] ? <p className="notice">{ERRORS[q.error]}</p> : null}
        {room <= 0 ? (
          <p>Your list is full. Remove a customer to add another.</p>
        ) : (
          <form method="post" action="/api/forms/watchlist-add" encType="multipart/form-data" className="grid max-w-xl gap-3">
            <label className="grid gap-1">
              <span className="font-semibold">Paste names, one per line</span>
              <span className="text-[0.9rem] text-muted">
                Add the city and state after commas if you know them: Pacific Tile Works Inc, Carlsbad, CA. Room for{" "}
                {room} more.
              </span>
              <textarea className="field" name="names" rows={6} />
            </label>
            <label className="grid gap-1">
              <span className="font-semibold">
                Or upload a CSV <span className="font-normal text-muted">(columns: name, city, state)</span>
              </span>
              <input type="file" name="file" accept=".csv,text/csv" />
            </label>
            <div>
              <button type="submit" className="btn">
                Add and match
              </button>
            </div>
          </form>
        )}
      </section>

      <section id="mutes">
        <h2>Kinds of events</h2>
        {q.saved === "mutes" ? <p className="notice">Saved.</p> : null}
        <form method="post" action="/api/forms/watchlist-mutes" className="grid gap-3">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(WATCH_EVENTS).map(([type, e]) => (
              <label key={type} className="flex items-start gap-2.5 text-[0.95rem]">
                <input className={box} type="checkbox" name="show" value={type} defaultChecked={!muted.has(type)} />
                <span>{e.label}</span>
              </label>
            ))}
          </div>
          <p className="m-0 text-[0.9rem] text-muted">Unchecked kinds stay off the email and this page until you turn them back on.</p>
          <div>
            <button type="submit" className="btn">
              Save
            </button>
          </div>
        </form>
      </section>

      <HandRaise tool="watchlist" prompt={ERP_PROMPT} returnTo="/watchlist/list" email={watcher.email} raised={q.raised === "1"} />
    </div>
  );
}
