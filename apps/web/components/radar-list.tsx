import { type Digest, publicRows } from "@jw/radar";

// The public view of a week: name, type and city only. Full detail stays in the emailed digest.
export function RadarList({ digest, limit }: { digest: Digest; limit?: number }) {
  const rows = publicRows(digest);
  const sections: Array<[string, typeof rows.newBusinesses]> = [
    ["New businesses", rows.newBusinesses],
    ["Liquor license activity, bars and restaurants", rows.liquor],
    ["New contractor licenses", rows.licenses],
  ];
  const shown = sections.filter(([, list]) => list.length > 0);
  if (shown.length === 0) {
    return <p className="text-muted">A quiet week: nothing new in this area.</p>;
  }
  return (
    <div>
      {shown.map(([title, list]) => (
        <section key={title}>
          <h2>
            {title} ({list.length})
          </h2>
          <ul>
            {(limit ? list.slice(0, limit) : list).map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <strong className="font-semibold">{r.name}</strong>
                <span className="text-muted">
                  {" "}
                  {r.type}
                  {r.city ? `, ${r.city}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {limit && list.length > limit ? (
            <p className="text-[0.95rem] text-muted">And {list.length - limit} more.</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
