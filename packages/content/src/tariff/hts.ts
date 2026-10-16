import { parseAdValorem } from "./calculator";

// One row from https://hts.usitc.gov/reststop/search?keyword=...
export interface HtsRow {
  htsno: string;
  description?: string | null;
  general?: string | null;
  indent?: string | number | null;
}

export interface HtsRate {
  htsNumber: string;
  description: string | null;
  generalRateText: string;
  adValoremPct: number | null;
}

export function htsDigits(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export function formatHts(digits: string): string {
  const parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8), digits.slice(8, 10)];
  return parts.filter(Boolean).join(".");
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// The USITC puts the general rate on the 8-digit line, or on a 10-digit line ending in 00.
// Statistical 10-digit lines leave it blank and inherit from the 8-digit line.
export function pickGeneralRate(rows: HtsRow[], input: string): HtsRate | null {
  const digits = htsDigits(input);
  if (digits.length < 8) return null;
  const eight = digits.slice(0, 8);
  const byDigits = new Map(rows.map((r) => [htsDigits(r.htsno), r]));
  const candidates = [
    digits.length >= 10 ? digits.slice(0, 10) : null,
    eight,
    `${eight}00`,
  ].filter((d): d is string => d !== null);

  for (const d of candidates) {
    const row = byDigits.get(d);
    const rate = clean(row?.general);
    if (row && rate) {
      return {
        htsNumber: formatHts(d),
        description: clean(row.description) || null,
        generalRateText: rate,
        adValoremPct: parseAdValorem(rate),
      };
    }
  }
  return null;
}
