import { manualDropSources } from "@jw/content";
import { desc, getDb, manualDrops } from "@jw/db";
import { DataTable, formatCell } from "@/components/data-table";
import { DropUpload } from "@/components/drop-upload";
import { requireAdmin } from "@/lib/server";

export default async function AdminDropsPage() {
  await requireAdmin();
  const drops = await getDb()
    .select({
      uploadedAt: manualDrops.uploadedAt,
      source: manualDrops.source,
      fileName: manualDrops.fileName,
      rowsSeen: manualDrops.rowsSeen,
      rowsKept: manualDrops.rowsKept,
      status: manualDrops.status,
      result: manualDrops.result,
      error: manualDrops.error,
      processedAt: manualDrops.processedAt,
    })
    .from(manualDrops)
    .orderBy(desc(manualDrops.uploadedAt))
    .limit(100);
  const sources = Object.entries(manualDropSources.sources);

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">Manual drops</h1>
      <p className="mb-6 text-muted">
        Files for sources with no automated download yet. Statewide files are cut to San Diego County on upload; the
        pipeline reads each one within half an hour and adds what it finds to the Watchlist and the Radar.
      </p>
      <DropUpload sources={sources.map(([id, s]) => [id, s.label])} />

      <h2 className="mb-3 text-[1.2rem] font-semibold">Uploads</h2>
      <DataTable
        rows={drops.map((d) => {
          const r = d.result as { events?: number; skipped?: Record<string, number>; matched?: Record<string, string> };
          return {
            uploadedAt: d.uploadedAt,
            source: manualDropSources.sources[d.source]?.label ?? d.source,
            fileName: d.fileName,
            rows: `${d.rowsKept} of ${d.rowsSeen}`,
            status: d.status,
            events: r.events ?? "",
            skipped: r.skipped ? formatCell(r.skipped) : "",
            matched: r.matched ? Object.entries(r.matched).map(([k, v]) => `${k}: ${v}`).join("; ") : "",
            error: d.error ?? "",
          };
        })}
        empty="Nothing uploaded yet."
        columns={[
          { key: "uploadedAt", label: "Uploaded" },
          { key: "source", label: "Source" },
          { key: "fileName", label: "File" },
          { key: "rows", label: "Rows kept" },
          { key: "status", label: "Status" },
          { key: "events", label: "Events" },
          { key: "skipped", label: "Skipped" },
          { key: "matched", label: "Columns used" },
          { key: "error", label: "Error" },
        ]}
      />

      <h2 className="mt-10 mb-3 text-[1.2rem] font-semibold">What each source needs</h2>
      <p className="mb-4 text-[0.95rem] text-muted">
        Column headers are matched without case, spaces or punctuation. To accept another header name, add it in{" "}
        <code>content/manual-drops.json</code>. Sources marked unconfirmed have not had a real file yet.
      </p>
      <div className="grid gap-5 text-[0.95rem]">
        {sources.map(([id, s]) => (
          <div key={id}>
            <p className="m-0 font-semibold">
              {s.label} {s.verify ? <span className="font-normal text-muted">(unconfirmed layout)</span> : null}
            </p>
            <p className="m-0">
              <a href={s.page} rel="noopener noreferrer" target="_blank">
                Where to get it
              </a>
              {s.statewide ? ". Statewide; cut to San Diego County on upload." : "."}
            </p>
            <p className="m-0 text-muted">
              {Object.entries(s.columns)
                .map(([, c]) => `${c.headers[0]}${c.required ? " (required)" : ""}`)
                .join(", ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
