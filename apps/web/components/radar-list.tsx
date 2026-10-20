import { type Digest, publicRows } from "@jw/radar";

// The public view of a week: name, type and city only. Full detail stays in the emailed digest.

// Same section colors as the Radar email.
const SECTIONS = [
  { key: "newBusinesses", title: "New businesses", short: ["new business", "new businesses"], color: "#12b76a", tint: "#ecfdf3" },
  { key: "liquor", title: "Liquor license activity, bars and restaurants", short: ["liquor license change", "liquor license changes"], color: "#7a5af8", tint: "#f4f3ff" },
  { key: "capital", title: "SBA loans over $250,000", short: ["SBA loan", "SBA loans"], color: "#1f4a6b", tint: "#eef4f9" },
  { key: "licenses", title: "New contractor licenses", short: ["contractor license", "contractor licenses"], color: "#f79009", tint: "#fffaeb" },
] as const;

type Row = { name: string; type: string; city: string | null };

export function radarCounts(digest: Digest) {
  const rows = publicRows(digest);
  return SECTIONS.map((s) => ({ ...s, rows: rows[s.key] as Row[] }));
}

export function RadarStats({ digest }: { digest: Digest }) {
  const sections = radarCounts(digest).filter((s) => s.rows.length > 0);
  if (sections.length === 0) return null;
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {sections.map((s) => (
        <a
          key={s.key}
          href={`#${s.key}`}
          className="block rounded-md border border-rule bg-white px-3.5 py-3 text-ink no-underline transition-shadow hover:shadow-sm"
          style={{ borderTop: `3px solid ${s.color}` }}
        >
          <span className="block text-[1.7rem] leading-none font-semibold tabular-nums">{s.rows.length}</span>
          <span className="mt-1.5 block text-[0.85rem] leading-snug text-muted">{s.rows.length === 1 ? s.short[0] : s.short[1]}</span>
        </a>
      ))}
    </div>
  );
}

export function RadarList({ digest, limit, moreHref }: { digest: Digest; limit?: number; moreHref?: string }) {
  const shown = radarCounts(digest).filter((s) => s.rows.length > 0);
  if (shown.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-rule bg-white px-5 py-8 text-center text-muted">
        A quiet week: nothing new in this area.
      </div>
    );
  }
  return (
    <div className="grid gap-9">
      {shown.map((s) => {
        const list = limit ? s.rows.slice(0, limit) : s.rows;
        return (
          <section key={s.key} id={s.key} className="scroll-mt-6">
            <h3 className="mb-3 flex items-start gap-2.5 text-[1.1rem] leading-snug font-semibold">
              <span className="mt-[0.45em] inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              <span>
                {s.title}
                <span className="ml-2 inline-block rounded-full px-2 py-0.5 align-[0.1em] text-[0.8rem] leading-none font-semibold tabular-nums" style={{ background: s.tint, color: "#344054" }}>
                  {s.rows.length}
                </span>
              </span>
            </h3>
            <div className="overflow-hidden rounded-md border border-rule bg-white">
              <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem] gap-4 border-b border-rule bg-[#f8f8f6] px-4 py-2 text-[0.75rem] font-semibold tracking-wider text-muted uppercase sm:grid">
                <span>Business</span>
                <span>{s.key === "newBusinesses" ? "Type" : "What happened"}</span>
                <span>City</span>
              </div>
              <ul className="m-0 list-none divide-y divide-rule p-0">
                {list.map((r, i) => (
                  <li
                    key={`${r.name}-${i}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-4 py-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem]"
                    style={{ boxShadow: `inset 3px 0 0 ${s.color}` }}
                  >
                    <span className="col-start-1 row-start-1 leading-snug font-semibold">{r.name}</span>
                    {/* On phones the city sits to the right of the name and the type goes underneath. */}
                    <span className="col-span-2 row-start-2 text-[0.92rem] leading-snug text-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">
                      {r.type.split("; ").map((part, j) => {
                        // "Liquor license issued (On-Sale General - Eating Place)": the license type goes on its own line.
                        const m = /^(.*?) \((.*)\)$/.exec(part);
                        return (
                          <span key={part} className={j > 0 ? "mt-1.5 block" : "block"}>
                            {m ? m[1] : part}
                            {m ? <span className="block text-[0.82rem] text-[#777]">{m[2]}</span> : null}
                          </span>
                        );
                      })}
                    </span>
                    <span className="col-start-2 row-start-1 pt-px text-right text-[0.92rem] leading-snug text-muted sm:col-start-3 sm:text-left">{r.city ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
            {limit && s.rows.length > limit ? (
              <p className="mt-2 mb-0 text-[0.92rem] text-muted">
                And {s.rows.length - limit} more.{" "}
                {moreHref ? <a href={`${moreHref}#${s.key}`}>See the full list</a> : null}
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
