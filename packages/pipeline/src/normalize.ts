import type { EntityType } from "@jw/db";

// Entity suffixes stripped from the end of a name, longest first so "A CALIFORNIA CORPORATION" goes before "CORPORATION".
const SUFFIXES = [
  "A CALIFORNIA LIMITED LIABILITY COMPANY",
  "A CALIFORNIA PROFESSIONAL CORPORATION",
  "A CALIFORNIA CORPORATION",
  "A PROFESSIONAL CORPORATION",
  "LIMITED LIABILITY COMPANY",
  "LIMITED PARTNERSHIP",
  "PROFESSIONAL CORPORATION",
  "INCORPORATED",
  "CORPORATION",
  "COMPANY",
  "LIMITED",
  "PLLC",
  "LLLP",
  "LLC",
  "LLP",
  "INC",
  "CORP",
  "LTD",
  "APC",
  "LP",
  "PC",
  "CO",
];

export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  let s = name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bL\.?\s?L\.?\s?C\.?(?=\s|$)/g, "LLC")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^THE /, "");
  // Strip suffixes repeatedly ("FOO CO INC").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (s.endsWith(` ${suffix}`) && s.length > suffix.length + 1) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

const STREET_TYPES: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  BOULEVARD: "BLVD",
  ROAD: "RD",
  DRIVE: "DR",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  CIRCLE: "CIR",
  TERRACE: "TER",
  WAY: "WAY",
  SUITE: "STE",
  APARTMENT: "APT",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
};

export function normalizeAddress(address: string | null | undefined): string {
  if (!address) return "";
  return address
    .toUpperCase()
    .replace(/#\s*/g, " STE ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_TYPES[w] ?? w)
    .join(" ");
}

export function zip5(zip: string | null | undefined): string | null {
  const m = (zip ?? "").match(/\d{5}/);
  return m ? m[0] : null;
}

export function titleCase(s: string | null | undefined): string | null {
  if (!s) return null;
  const small = new Set(["OF", "AND", "THE", "AT", "IN", "ON", "FOR", "A", "AN"]);
  const keep = new Set(["LLC", "INC", "LP", "LLP", "DBA", "USA", "II", "III", "IV", "PC", "APC"]);
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const u = w.toUpperCase();
      if (keep.has(u.replace(/[^A-Z]/g, ""))) return u;
      if (i > 0 && small.has(u)) return u.toLowerCase();
      return u.charAt(0) + u.slice(1).toLowerCase();
    })
    .join(" ");
}

// Maps the many ways sources describe ownership onto our small set.
export function entityTypeFrom(text: string | null | undefined): EntityType | null {
  const t = (text ?? "").toUpperCase();
  if (!t.trim()) return null;
  if (/SOLE|INDIVIDUAL|PROPRIETOR|OWNER\b/.test(t)) return "sole_prop";
  if (/LIMITED LIABILITY PARTNERSHIP|\bLLP\b|\bLLLP\b/.test(t)) return "partnership";
  if (/L\.?L\.?C|LIMITED LIABILITY/.test(t)) return "llc";
  if (/NON\s?-?PROFIT|NONPROFIT|501/.test(t)) return "nonprofit";
  if (/CORP|INC\b|INCORPORATED/.test(t)) return "corporation";
  if (/PARTNER|\bLP\b|\bLLP\b|JOINT VENTURE/.test(t)) return "partnership";
  if (/GOVERN|CITY OF|COUNTY OF|STATE OF|PUBLIC AGENCY/.test(t)) return "government";
  return "other";
}

// True when a licensee name reads like an organization rather than a person. Sources such as
// ABC list individual licensees as "LAST  FIRST"; those must never be stored or shown.
export function isOrganizationName(name: string | null | undefined): boolean {
  const n = ` ${(name ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ")} `;
  if (entityTypeFromName(name)) return true;
  return /\s(CO|COMPANY|CORPORATION|INCORPORATED|LTD|LIMITED|ASSOCIATION|ASSN|GROUP|TRUST|ENTERPRISES?|HOLDINGS?|PARTNERS|PARTNERSHIP|VENTURES?|CLUB|FOUNDATION|CHURCH|SOCIETY|LODGE|POST|UNIVERSITY|COLLEGE|SCHOOL|DISTRICT|AUTHORITY|HOSPITAL|RESTAURANTS?|HOTELS?|MARKETS?|BREWING|BREWERY|WINERY|VINEYARDS?|CELLARS|FOODS?|GRILL|CAFE|BAR|TAVERN|PUB|LIQUORS?|STORES?|CITY OF|COUNTY OF|STATE OF)\s/.test(
    n,
  );
}

// A rough guess from the name alone, for sources that do not say.
export function entityTypeFromName(name: string | null | undefined): EntityType | null {
  const n = (name ?? "").toUpperCase();
  if (/\bL\.?\s?L\.?\s?C\.?\b|LIMITED LIABILITY/.test(n)) return "llc";
  if (/\b(INC|INCORPORATED|CORP|CORPORATION)\b/.test(n)) return "corporation";
  if (/\b(LP|LLP|LLLP|PARTNERSHIP)\b/.test(n)) return "partnership";
  return null;
}

// JSON with object keys sorted at every level. Postgres jsonb reorders keys, so this is how
// a stored record is compared with a fresh one.
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// Words that mark a business name. Rows a source marks as businesses can still carry a bare
// personal name (a private investigator licensed as a firm under their own name); those are skipped.
const BUSINESS_WORDS =
  /\b(AUTO|AUTOMOTIVE|AUTOBODY|REPAIR|TIRES?|SMOG|BODY|MOTORS?|GARAGE|TRANSMISSION|BRAKES?|GLASS|COLLISION|SERVICES?|CENTER|CTR|SHOP|SALON|SPA|NAILS?|HAIR|BEAUTY|BARBER(SHOP)?|STUDIO|LASH|BROWS?|CLIPS|CUTS|WAX|MEDICAL|MEDICINE|HEALTH|CARE|CLINIC|CENTERS?|PHARMACY|DRUGS?|RX|VETERINARY|ANIMAL|PETS?|HOSPITAL|PEST|TERMITE|EXTERMINAT\w*|SECURITY|PATROL|ALARMS?|LOCKS?|LOCKSMITH|KEYS?|INVESTIGATIONS?|INVESTIGATIVE|PROTECTION|PROTECTIVE|CPAS?|ACCOUNTANCY|ACCOUNTING|ACCOUNTANTS?|TAX|BOOKKEEPING|APPLIANCES?|ELECTRONICS?|OPTOMETRY|OPTOMETRIC|VISION|EYE|EYECARE|OPTICAL|CHIROPRACTIC|CHIRO|FUNERAL|MORTUARY|CHAPEL|CREMATION|SOLUTIONS|ASSOCIATES|PARTNERS|AND|OF)\b/;

export function looksLikePerson(name: string): boolean {
  if (isOrganizationName(name)) return false;
  const n = name.toUpperCase();
  if (/[0-9#&@/]/.test(n) || BUSINESS_WORDS.test(n)) return false;
  // A bare "FIRST LAST" or "FIRST M LAST"; longer names are taken as trade names.
  const words = n.split(/[\s,.]+/).filter(Boolean);
  return words.length === 2 || (words.length === 3 && words[1]!.length === 1);
}
