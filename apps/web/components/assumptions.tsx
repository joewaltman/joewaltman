import type { Assumption } from "@jw/content";

// Superscript links to the numbered assumptions at the bottom of the page.
export function Notes({ notes }: { notes?: number[] }) {
  if (!notes || notes.length === 0) return null;
  return (
    <sup className="ml-0.5 text-[0.75em]">
      {notes.map((n, i) => (
        <span key={n}>
          {i > 0 ? "," : ""}
          <a href={`#assumption-${n}`} className="no-underline" aria-label={`Assumption ${n}`}>
            {n}
          </a>
        </span>
      ))}
    </sup>
  );
}

export function AssumptionList({ assumptions }: { assumptions?: Assumption[] }) {
  if (!assumptions || assumptions.length === 0) return null;
  return (
    <section>
      <h2>Assumptions</h2>
      <p className="text-[0.95rem] text-muted">
        Where the sources were thin or disagreed, the tool made a judgment call. Each one is marked
        with a number above.
      </p>
      <ol className="list-decimal pl-5 text-[0.95rem]">
        {assumptions.map((a, i) => (
          <li key={a.id} id={`assumption-${i + 1}`} className="mb-2">
            {a.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
