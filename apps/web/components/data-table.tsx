import type { ReactNode } from "react";

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 16);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataTable({
  columns,
  rows,
  empty = "Nothing yet.",
}: {
  columns: Array<{ key: string; label: string; render?: (row: Record<string, unknown>) => ReactNode }>;
  rows: Array<Record<string, unknown>>;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.9rem]">
        <thead>
          <tr className="border-b border-rule text-left">
            {columns.map((c) => (
              <th key={c.key} className="py-2 pr-4 font-semibold whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)} className="border-b border-rule align-top">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4">
                  {c.render ? c.render(row) : formatCell(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
