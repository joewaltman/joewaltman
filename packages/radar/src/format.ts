import { type Digest, categoryLabel, clusterLabel } from "./digest";

export const EMAIL_ITEMS_PER_SECTION = 50;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return { y, month: MONTHS[m - 1]!, d };
};
const shortDate = (iso: string) => {
  const p = parts(iso);
  return `${p.month.slice(0, 3)} ${p.d}`;
};

// "October 12 to 18, 2026", or "September 28 to October 4, 2026" across a month.
export function weekLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  return a.month === b.month ? `${a.month} ${a.d} to ${b.d}, ${b.y}` : `${a.month} ${a.d} to ${b.month} ${b.d}, ${b.y}`;
}

// "North County coastal", "North County coastal and South Bay", "A, B and C".
export function areasLabel(clusters: string[]): string {
  const labels = clusters.map(clusterLabel);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

const place = (city: string | null, zip: string | null) => [city, zip].filter(Boolean).join(" ") || "San Diego County";

export interface EmailRow {
  key: string;
  name: string;
  // Legal name, one-line note, loan or license detail.
  sub: string | null;
  what: string;
  place: string;
  date: string;
  website: string | null;
}

export interface EmailSection {
  id: "new" | "liquor" | "capital" | "licenses";
  title: string;
  rows: EmailRow[];
  // Rows past the email's limit, which are in the CSV.
  more: number;
}

// The digest as table rows for the email, up to EMAIL_ITEMS_PER_SECTION per section.
export function digestEmailSections(d: Digest): EmailSection[] {
  const cap = (rows: EmailRow[]) => ({ rows: rows.slice(0, EMAIL_ITEMS_PER_SECTION), more: Math.max(0, rows.length - EMAIL_ITEMS_PER_SECTION) });
  const join = (...parts: Array<string | null | undefined>) => parts.filter((p): p is string => Boolean(p && p.trim())).map((p) => p.trim().replace(/\.$/, "")).join(". ") || null;
  return [
    {
      id: "new",
      title: "New businesses",
      ...cap(
        d.newBusinesses.map((r) => ({
          key: r.entityId,
          name: r.name,
          sub: join(r.legalName ? `Legal name: ${r.legalName}` : null, r.note),
          what: categoryLabel(r.category) ?? "Business",
          place: place(r.city, r.zip),
          date: shortDate(r.firstSeen),
          website: r.website,
        })),
      ),
    },
    {
      id: "liquor",
      title: "Liquor license activity, bars and restaurants",
      ...cap(d.liquor.map((r) => ({ key: r.entityId, name: r.name, sub: join(r.details), what: r.title, place: place(r.city, r.zip), date: shortDate(r.date), website: null }))),
    },
    {
      id: "capital",
      title: "SBA loans over $250,000",
      ...cap(d.capital.map((r) => ({ key: `${r.entityId}-${r.date}`, name: r.name, sub: join(r.details), what: r.title, place: place(r.city, r.zip), date: shortDate(r.date), website: null }))),
    },
    {
      id: "licenses",
      title: "New contractor licenses",
      ...cap(d.licenses.map((r) => ({ key: `${r.entityId}-${r.date}`, name: r.name, sub: join(r.details), what: "Contractor license", place: place(r.city, r.zip), date: shortDate(r.date), website: null }))),
    },
  ];
}
