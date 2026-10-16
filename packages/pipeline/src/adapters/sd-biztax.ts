import type { EntityType } from "@jw/db";
import { parse } from "csv-parse/sync";
import { normalizeName, titleCase } from "../normalize";
import { addEvent, type EntityRecord, upsertEntity } from "../resolve";
import { type Adapter, type FetchedFile, download } from "../runner";
import { pacificDay } from "../schedule";

// City of San Diego business tax certificates. Rebuilt daily around 09:07 UTC; the file names never change.
// New accounts cancelled soon after creation move to the inactive file, so both are read.
const BASE = "https://seshat.datasd.org/business_tax_certificates/";
export const SD_BIZTAX_FILES = ["sd_businesses_active_datasd.csv", "sd_businesses_inactive_2015tocurr_datasd.csv"];
export const SD_BIZTAX_PAGE = "https://data.sandiego.gov/datasets/business-tax-certificates/";

// Data lands about a day late, so look back further than the 7-day "new" window. Events dedupe on re-runs.
export const LOOKBACK_DAYS = 10;

const OWNERSHIP: Record<string, EntityType> = {
  SOLE: "sole_prop",
  "H-W": "sole_prop",
  CORP: "corporation",
  SCORP: "corporation",
  LLC: "llc",
  PARTNR: "partnership",
  LP: "partnership",
  "NO/PRF": "nonprofit",
  TRUST: "other",
};

// Columns that describe where a person lives or who they are; dropped for sole proprietors.
const PERSONAL_COLUMNS = [
  "business_owner_name",
  "address_no",
  "address_pd",
  "address_road",
  "address_sfx",
  "address_no_fraction",
  "address_suite",
  "address_pmb_box",
  "address_po_box",
  "lat",
  "lng",
];

type Row = Record<string, string>;

export interface BizTaxRecord {
  entity: EntityRecord;
  accountKey: string;
  createdOn: string;
  status: string;
  ownershipType: string;
  naicsDescription: string | null;
}

const day = (s: string | undefined) => {
  const d = (s ?? "").slice(0, 10);
  const year = Number(d.slice(0, 4));
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && year >= 1900 && year <= 2100 ? d : null;
};

function street(r: Row): string | null {
  const line = [r.address_no, r.address_no_fraction, r.address_pd, r.address_road, r.address_sfx]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  if (line) return titleCase(line);
  return r.address_po_box?.trim() ? `PO Box ${r.address_po_box.trim()}` : null;
}

// Turns one CSV row into a record, or null when the row is about a person rather than a business.
export function toRecord(r: Row): BizTaxRecord | null {
  const accountKey = (r.account_key ?? "").replace(/\.0+$/, "").trim();
  const createdOn = day(r.date_account_creation);
  if (!accountKey || !createdOn) return null;
  const ownershipType = (r.ownership_type ?? "").trim();
  const entityType = OWNERSHIP[ownershipType] ?? "other";
  const solo = entityType === "sole_prop";
  const legal = (r.business_owner_name ?? "").trim();
  const dba = (r.dba_name ?? "").trim();

  // For sole proprietors and husband-wife owners, the owner column is a person's name. Use only the
  // trade name, and skip the row when the trade name is just the person's name.
  let name: string;
  let dbaOut: string | null;
  if (solo) {
    if (!dba || normalizeName(dba) === normalizeName(legal)) return null;
    name = dba;
    dbaOut = null;
  } else {
    name = legal || dba;
    dbaOut = dba && normalizeName(dba) !== normalizeName(name) ? dba : null;
  }
  if (!name) return null;

  const raw: Record<string, unknown> = { ...r };
  if (solo) for (const c of PERSONAL_COLUMNS) delete raw[c];

  const suite = r.address_suite?.trim();
  const pmb = r.address_pmb_box?.trim();
  return {
    accountKey,
    createdOn,
    status: (r.account_status ?? "").trim(),
    ownershipType,
    naicsDescription: r.naics_description?.trim() || null,
    entity: {
      source: "sd_biztax",
      sourceId: accountKey,
      name: titleCase(name)!,
      dba: dbaOut ? titleCase(dbaOut) : null,
      entityType,
      status: (r.account_status ?? "").trim() || null,
      formedAt: day(r.date_business_start),
      address1: street(r),
      address2: suite ? `Ste ${suite}` : pmb ? `PMB ${pmb}` : null,
      city: titleCase(r.address_city),
      state: r.address_state?.trim() || null,
      zip: r.address_zip,
      naics: r.naics_code?.trim() || null,
      raw,
    },
  };
}

export function parseBizTax(files: FetchedFile[], now: Date): BizTaxRecord[] {
  const cutoff = pacificDay(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));
  const byKey = new Map<string, BizTaxRecord>();
  for (const f of files) {
    const rows = parse(Buffer.from(f.body), { columns: true, skip_empty_lines: true, bom: true }) as Row[];
    if (rows.length > 0 && !("account_key" in rows[0]!)) {
      throw new Error(`${f.name}: no account_key column; the city changed the file format`);
    }
    for (const row of rows) {
      if ((row.date_account_creation ?? "").slice(0, 10) < cutoff) continue;
      const rec = toRecord(row);
      // The active file wins if an account shows up in both.
      if (rec && !byKey.has(rec.accountKey)) byKey.set(rec.accountKey, rec);
    }
  }
  return [...byKey.values()];
}

const describe = (r: BizTaxRecord) =>
  [r.ownershipType === "NO/PRF" ? "Nonprofit" : r.ownershipType, r.naicsDescription?.toLowerCase()]
    .filter(Boolean)
    .join(", ");

export const sdBizTax: Adapter<BizTaxRecord> = {
  name: "sd-biztax",
  source: "sd_biztax",
  async fetch(ctx) {
    const files: FetchedFile[] = [];
    for (const f of SD_BIZTAX_FILES) files.push(await download(ctx, `${BASE}${f}`, f));
    return files;
  },
  parse: (files, ctx) => parseBizTax(files, ctx.now),
  async upsert(records, ctx) {
    let events = 0;
    for (const r of records) {
      const { entityId } = await upsertEntity(ctx.db, r.entity, ctx.now);
      if (
        await addEvent(ctx.db, {
          entityId,
          source: "sd_biztax",
          eventType: "new_business",
          eventDate: r.createdOn,
          severity: "info",
          title: "New City of San Diego business tax certificate",
          summary: describe(r) || null,
          sourceUrl: SD_BIZTAX_PAGE,
          dedupeKey: `sd_biztax:${r.accountKey}:new`,
        })
      )
        events++;
      if (
        r.status === "Cancelled" &&
        (await addEvent(ctx.db, {
          entityId,
          source: "sd_biztax",
          eventType: "account_cancelled",
          eventDate: null,
          severity: "watch",
          title: "City business tax account cancelled",
          sourceUrl: SD_BIZTAX_PAGE,
          dedupeKey: `sd_biztax:${r.accountKey}:cancelled`,
        }))
      )
        events++;
    }
    return { rowsUpserted: records.length, events };
  },
};
