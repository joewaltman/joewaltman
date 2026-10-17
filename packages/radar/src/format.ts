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

export function digestEmailSections(d: Digest): Array<{ title: string; items: string[]; more: number }> {
  const cap = <T>(rows: T[], line: (r: T) => string) => ({
    items: rows.slice(0, EMAIL_ITEMS_PER_SECTION).map(line),
    more: Math.max(0, rows.length - EMAIL_ITEMS_PER_SECTION),
  });
  return [
    {
      title: "New businesses",
      ...cap(d.newBusinesses, (r) =>
        [
          `${r.name}${r.legalName ? ` (${r.legalName})` : ""}, ${categoryLabel(r.category)?.toLowerCase() ?? "business"}, ${place(r.city, r.zip)}.`,
          `First seen ${shortDate(r.firstSeen)}.`,
          r.note ?? "",
          r.sources.length ? `Source: ${r.sources.join(", ")}.` : "",
          r.website ?? "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    },
    {
      title: "Liquor license activity, bars and restaurants",
      ...cap(d.liquor, (r) => `${r.name}, ${place(r.city, r.zip)}: ${r.title}${r.details ? `. ${r.details}` : ""}. ${shortDate(r.date)}.`),
    },
    {
      title: "SBA loans over $250,000",
      ...cap(d.capital, (r) => `${r.name}, ${place(r.city, r.zip)}: ${r.title}. ${r.details ?? ""}`.trim().replace(/([^.])$/, "$1.")),
    },
    {
      title: "New contractor licenses",
      ...cap(d.licenses, (r) => `${r.name}, ${place(r.city, r.zip)}${r.details ? `. ${r.details}` : ""}. Issued ${shortDate(r.date)}.`),
    },
  ];
}
