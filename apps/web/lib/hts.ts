import { type HtsRate, type HtsRow, formatHts, htsDigits, pickGeneralRate } from "@jw/content";
import { type Db, eq, htsRates } from "@jw/db";

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_URL = "https://hts.usitc.gov/reststop/search?keyword=";

export type HtsLookup =
  | { status: "ok"; rate: HtsRate; sourceUrl: string; fetchedAt: Date }
  | { status: "invalid" }
  | { status: "not-found"; sourceUrl: string }
  | { status: "unavailable" };

export function htsSourceUrl(digits: string): string {
  return `https://hts.usitc.gov/search?query=${formatHts(digits.slice(0, 8))}`;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// Looks up the MFN general rate from the USITC, caching results (including misses) for a week.
export async function lookupHts(db: Db, input: string, fetchImpl: Fetch = fetch): Promise<HtsLookup> {
  const digits = htsDigits(input);
  if (digits.length < 8 || digits.length > 10) return { status: "invalid" };
  const sourceUrl = htsSourceUrl(digits);

  const [cached] = await db.select().from(htsRates).where(eq(htsRates.htsNumber, digits)).limit(1);
  const fromCache = (): HtsLookup =>
    cached!.generalRateText
      ? {
          status: "ok",
          sourceUrl,
          fetchedAt: cached!.fetchedAt,
          rate: {
            htsNumber: (cached!.raw as { matched?: string } | null)?.matched ?? formatHts(digits),
            description: cached!.description,
            generalRateText: cached!.generalRateText,
            adValoremPct: cached!.adValoremPct,
          },
        }
      : { status: "not-found", sourceUrl };
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS) return fromCache();

  let rows: HtsRow[];
  try {
    const res = await fetchImpl(`${SEARCH_URL}${formatHts(digits.slice(0, 8))}`, {
      headers: { Accept: "application/json", "User-Agent": "joewaltman.com tariff calculator" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`USITC returned ${res.status}`);
    const body: unknown = await res.json();
    rows = Array.isArray(body) ? (body as HtsRow[]) : [];
  } catch {
    // A stale cached rate beats no rate when the USITC is slow or down.
    return cached ? fromCache() : { status: "unavailable" };
  }

  const rate = pickGeneralRate(rows, digits);
  const values = {
    description: rate?.description ?? null,
    generalRateText: rate?.generalRateText ?? null,
    adValoremPct: rate?.adValoremPct ?? null,
    sourceUrl,
    // The line the rate came from can differ from the code typed in (a statistical suffix inherits).
    raw: { matched: rate?.htsNumber ?? null, rows: rows.slice(0, 20) },
    fetchedAt: new Date(),
  };
  await db
    .insert(htsRates)
    .values({ htsNumber: digits, ...values })
    .onConflictDoUpdate({ target: htsRates.htsNumber, set: values });

  return rate
    ? { status: "ok", rate, sourceUrl, fetchedAt: values.fetchedAt }
    : { status: "not-found", sourceUrl };
}
