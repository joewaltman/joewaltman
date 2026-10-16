import { createHmac, timingSafeEqual } from "node:crypto";
import { type Digest, categoryLabel, clusterLabel } from "./digest";

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// One row per item, all sections, for a spreadsheet or CRM import.
export function digestCsv(d: Digest): string {
  const header = ["section", "date", "name", "legal_name", "category", "city", "zip", "area", "sources", "details", "website", "source_url"];
  const rows: unknown[][] = [
    ...d.newBusinesses.map((r) => [
      "New business",
      r.firstSeen,
      r.name,
      r.legalName,
      categoryLabel(r.category),
      r.city,
      r.zip,
      r.cluster ? clusterLabel(r.cluster) : "",
      r.sources.join("; "),
      r.note,
      r.website,
      "",
    ]),
    ...d.liquor.map((r) => ["Liquor license", r.date, r.name, "", "", r.city, r.zip, r.cluster ? clusterLabel(r.cluster) : "", "ABC liquor license", [r.title, r.details].filter(Boolean).join(": "), "", r.sourceUrl]),
    ...d.licenses.map((r) => ["New license", r.date, r.name, "", "", r.city, r.zip, r.cluster ? clusterLabel(r.cluster) : "", "CSLB contractor license", r.details, "", r.sourceUrl]),
  ];
  return `${[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

// Signed links so a subscriber's CSV works without signing in and cannot be guessed.
function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 32);
}

export function csvToken(subscriberId: string, end: string, secret: string): string {
  const payload = `${subscriberId}.${end}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function readCsvToken(token: string, secret: string): { subscriberId: string; end: string } | null {
  const m = token.match(/^([0-9a-f-]{36})\.(\d{4}-\d{2}-\d{2})\.([A-Za-z0-9_-]{32})$/);
  if (!m) return null;
  const expected = Buffer.from(sign(`${m[1]}.${m[2]}`, secret));
  const given = Buffer.from(m[3]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { subscriberId: m[1]!, end: m[2]! };
}
