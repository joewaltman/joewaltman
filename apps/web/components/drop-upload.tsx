"use client";

import { useState } from "react";

// Sends the file as the raw request body, so even a large statewide file streams to the server
// instead of being held in a form. The server keeps only what it needs.
export function DropUpload({ sources }: { sources: Array<[string, string]> }) {
  const [source, setSource] = useState(sources[0]?.[0] ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{ busy: boolean; message?: string; error?: string }>({ busy: false });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setState({ busy: true });
    try {
      const res = await fetch(`/admin/drops-upload?source=${encodeURIComponent(source)}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      const body = (await res.json()) as { error?: string; rowsSeen?: number; rowsKept?: number };
      if (!res.ok || body.error) setState({ busy: false, error: body.error ?? `Upload failed (HTTP ${res.status})` });
      else {
        setState({ busy: false, message: `Stored ${body.rowsKept} of ${body.rowsSeen} rows. The pipeline reads it within half an hour.` });
        window.setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  return (
    <form onSubmit={upload} className="mb-8 grid max-w-xl gap-3">
      <label className="grid gap-1">
        <span className="text-[0.95rem] font-semibold">Source</span>
        <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
          {sources.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-[0.95rem] font-semibold">File (CSV, tab or pipe separated; .gz is fine)</span>
        <input type="file" accept=".csv,.txt,.tsv,.gz,text/csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
      </label>
      <div>
        <button type="submit" className="btn" disabled={state.busy || !file}>
          {state.busy ? "Uploading..." : "Upload"}
        </button>
      </div>
      {state.message ? <p className="notice">{state.message}</p> : null}
      {state.error ? <p className="notice">{state.error}</p> : null}
    </form>
  );
}
