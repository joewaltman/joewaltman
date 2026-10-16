import { type DropSourceConfig, countyForZip } from "@jw/content";
import { zip5 } from "../normalize";

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Tab, pipe or comma, whichever splits the header line into the most columns.
export function detectDelimiter(headerLine: string): string {
  const counts = ["\t", "|", ","].map((d) => [d, headerLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

// One line into cells, honoring double quotes within the line.
export function splitLine(line: string, delimiter: string): string[] {
  if (delimiter !== "," || !line.includes('"')) return line.split(delimiter).map((c) => c.trim());
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") quoted = true;
    else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

export interface ColumnMap {
  cols: Record<string, number>;
  // Field name to the header it matched, for the admin page.
  matched: Record<string, string>;
  missing: string[];
}

export function mapColumns(config: DropSourceConfig, header: string[]): ColumnMap {
  const normalized = header.map(normalizeHeader);
  const cols: Record<string, number> = {};
  const matched: Record<string, string> = {};
  const missing: string[] = [];
  for (const [field, spec] of Object.entries(config.columns)) {
    const idx = spec.headers.map(normalizeHeader).map((h) => normalized.indexOf(h)).find((i) => i >= 0);
    if (idx !== undefined) {
      cols[field] = idx;
      matched[field] = header[idx]!;
    } else if (spec.required) missing.push(field);
  }
  return { cols, matched, missing };
}

// For statewide sources, whether a row is in San Diego County, by its county or ZIP column.
// A source file with neither column keeps every row.
export function inSanDiego(row: string[], map: ColumnMap): boolean {
  const countyCol = map.cols.county;
  if (countyCol !== undefined && row[countyCol]) return row[countyCol]!.trim().toUpperCase() === "SAN DIEGO";
  const zipCol = map.cols.zip ?? map.cols.debtorZip;
  if (zipCol === undefined) return true;
  const zip = zip5(row[zipCol]);
  return zip !== null && countyForZip(zip) === "San Diego";
}

// Dates as sources write them: 2026-10-14, 10/14/2026, 10-14-2026, 20261014.
export function parseDate(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
