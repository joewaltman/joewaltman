import { and, entityIdentifiers, eq, type Severity } from "@jw/db";
import { parse } from "csv-parse/sync";
import { entityTypeFrom, normalizeName, stableJson, titleCase } from "../normalize";
import { addEvent, type EntityRecord, upsertEntity } from "../resolve";
import { type Adapter, type FetchedFile, download } from "../runner";
import { pacificDay } from "../schedule";

// California Contractors State License Board master file: every current license statewide,
// regenerated daily. One plain GET, no terms to accept. Events come from comparing each
// license with the previous run.
export const CSLB_MASTER_URL =
  "https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C";
export const licenseUrl = (license: string) =>
  `https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${license}`;

// The download is sometimes cut short with no error, which would look like thousands of
// licenses vanishing. These checks reject a short file so the fetch retries.
export const MIN_ROWS = 200_000;
export const MAX_REMOVED_SHARE = 0.05;
const NEW_LICENSE_DAYS = 45;

type Row = Record<string, string>;

export interface CslbRecord {
  license: string;
  issued: string | null;
  entity: EntityRecord;
}

// "07/23/1963" -> "1963-07-23"
function date(s: string | undefined): string | null {
  const m = (s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

const clean = (s: string | undefined) => (s ?? "").trim();

export function looksComplete(body: Uint8Array, minRows = MIN_ROWS): boolean {
  if (body.length < 2 || body[body.length - 2] !== 0x0d || body[body.length - 1] !== 0x0a) return false;
  let lines = 0;
  for (let i = 0; i < body.length; i++) if (body[i] === 0x0a) lines++;
  return lines > minRows;
}

export function parseCslb(body: Uint8Array, minRows = MIN_ROWS): CslbRecord[] {
  let total = 0;
  const rows = parse(Buffer.from(body), {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    // Some names carry a bare quote mark mid-field, such as DOUBLE "D" CONSTRUCTION.
    relax_quotes: true,
    on_record: (record: Row) => {
      total++;
      return clean(record.County) === "San Diego" ? record : null;
    },
  }) as Row[];
  if (total < minRows) throw new Error(`CSLB master file has ${total} rows, fewer than ${minRows}; download looks incomplete`);
  if (rows.length > 0 && !("LicenseNo" in rows[0]! && "PrimaryStatus" in rows[0]!)) {
    throw new Error("CSLB master file has no LicenseNo or PrimaryStatus column; the format changed");
  }

  const out: CslbRecord[] = [];
  for (const r of rows) {
    const license = clean(r.LicenseNo);
    if (!license) continue;
    const businessType = clean(r.BusinessType);
    const entityType = entityTypeFrom(businessType);
    const shown = clean(r.BusinessName);
    const legal = clean(r["NAME-TP-2"]) === "Current Name" ? clean(r["BUS-NAME-2"]) : "";

    // Sole owners appear under their own name unless a separate trade name is on file.
    const solo = entityType === "sole_prop";
    if (solo && (!legal || normalizeName(legal) === normalizeName(shown))) continue;
    const name = solo ? shown : legal || shown;
    const dba = !solo && legal && normalizeName(legal) !== normalizeName(shown) ? shown : null;

    const raw: Record<string, unknown> = {
      license,
      business_type: businessType,
      business_name: solo ? null : shown,
      legal_name: solo ? null : legal || null,
      trade_name: solo ? shown : dba,
      issue_date: date(r.IssueDate),
      expiration_date: date(r.ExpirationDate),
      primary_status: clean(r.PrimaryStatus),
      secondary_status: clean(r.SecondaryStatus) || null,
      classifications: clean(r["Classifications(s)"]).split("|").map((c) => c.trim()).filter(Boolean),
      workers_comp_type: clean(r.WorkersCompCoverageType) || null,
      workers_comp_carrier: clean(r.WCInsuranceCompany) || null,
      workers_comp_expires: date(r.WCExpirationDate),
      workers_comp_cancelled: date(r.WCCancellationDate),
      bond_surety: clean(r.CBSuretyCompany) || null,
      bond_amount: clean(r.CBAmount) || null,
      bond_cancelled: date(r.CBCancellationDate),
      llc_worker_bond_cancelled: date(r.WBCancellationDate),
    };

    out.push({
      license,
      issued: date(r.IssueDate),
      entity: {
        source: "cslb",
        sourceId: license,
        name: titleCase(name)!,
        dba: dba ? titleCase(dba) : null,
        entityType,
        status: clean(r.PrimaryStatus) || null,
        formedAt: date(r.IssueDate),
        address1: titleCase(r.MailingAddress),
        city: titleCase(r.City),
        state: clean(r.State) || "CA",
        zip: clean(r.ZIPCode),
        county: "San Diego",
        // Every contractor license is construction work.
        naics: "23",
        phone: clean(r.BusinessPhone) || null,
        raw,
      },
    });
  }
  return out;
}

interface Change {
  eventType: string;
  severity: Severity;
  title: string;
  summary: string | null;
  eventDate: string | null;
  key: string;
}

// What changed for one license since the last run. First sight only counts when the license is new.
export function changesFor(rec: CslbRecord, before: Record<string, unknown> | null, today: string): Change[] {
  const now = rec.entity.raw;
  const out: Change[] = [];
  if (!before) {
    const cutoff = pacificDay(new Date(new Date(`${today}T12:00:00Z`).getTime() - NEW_LICENSE_DAYS * 86_400_000));
    if (rec.issued && rec.issued >= cutoff) {
      const classes = (now.classifications as string[]).join(", ");
      out.push({
        eventType: "cslb_new_license",
        severity: "info",
        title: "New contractor license",
        summary: classes ? `Classifications: ${classes}` : null,
        eventDate: rec.issued,
        key: "new",
      });
    }
    return out;
  }
  if (before.primary_status !== now.primary_status) {
    const clear = now.primary_status === "CLEAR";
    out.push({
      eventType: "cslb_status_change",
      severity: clear ? "info" : "watch",
      title: `Contractor license status: ${String(before.primary_status ?? "unknown")} to ${String(now.primary_status)}`,
      summary: (now.secondary_status as string | null) ?? null,
      eventDate: today,
      key: `status:${String(now.primary_status)}`,
    });
  }
  if (now.bond_cancelled && before.bond_cancelled !== now.bond_cancelled) {
    out.push({
      eventType: "cslb_bond_cancellation",
      severity: "watch",
      title: "Contractor bond cancellation on file",
      summary: `Cancellation date ${String(now.bond_cancelled)}${now.bond_surety ? `, surety ${String(now.bond_surety)}` : ""}`,
      eventDate: now.bond_cancelled as string,
      key: `bond:${String(now.bond_cancelled)}`,
    });
  }
  if (before.workers_comp_type !== now.workers_comp_type) {
    const lapsed = /does not have current/i.test(String(now.workers_comp_type ?? ""));
    out.push({
      eventType: "cslb_workers_comp_change",
      severity: lapsed ? "watch" : "info",
      title: `Workers' comp coverage: ${String(before.workers_comp_type ?? "none")} to ${String(now.workers_comp_type ?? "none")}`,
      summary: null,
      eventDate: today,
      key: `wc:${String(now.workers_comp_type ?? "")}`,
    });
  }
  return out;
}

export const cslb: Adapter<CslbRecord> = {
  name: "cslb",
  source: "cslb",
  async fetch(ctx) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const file = await download(ctx, CSLB_MASTER_URL, "MasterLicenseData.csv");
      if (looksComplete(file.body)) return [file];
      ctx.log(`cslb: download attempt ${attempt} looks cut short (${file.body.length} bytes); retrying`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
    throw new Error("CSLB master file download was cut short four times");
  },
  parse: (files: FetchedFile[]) => files.flatMap((f) => parseCslb(f.body)),
  async upsert(records, ctx) {
    const today = pacificDay(ctx.now);
    const existing = await ctx.db
      .select({ sourceId: entityIdentifiers.sourceId, entityId: entityIdentifiers.entityId, raw: entityIdentifiers.raw })
      .from(entityIdentifiers)
      .where(eq(entityIdentifiers.source, "cslb"));
    const before = new Map(existing.map((e) => [e.sourceId, e]));
    const present = new Set(records.map((r) => r.license));

    // Licenses already marked removed on an earlier run are not counted again.
    const current = existing.filter((e) => !e.raw.removed_on);
    const removed = current.filter((e) => !present.has(e.sourceId));
    if (current.length > 1000 && removed.length > current.length * MAX_REMOVED_SHARE) {
      throw new Error(
        `CSLB: ${removed.length} of ${current.length} known San Diego licenses are missing today; refusing to record that many removals`,
      );
    }

    let rowsUpserted = 0;
    let events = 0;
    for (const rec of records) {
      const prev = before.get(rec.license);
      if (prev && stableJson(prev.raw) === stableJson(rec.entity.raw)) continue;
      const changes = changesFor(rec, prev?.raw ?? null, today);
      const { entityId } = await upsertEntity(ctx.db, rec.entity, ctx.now);
      rowsUpserted++;
      for (const c of changes) {
        const added = await addEvent(ctx.db, {
          entityId,
          source: "cslb",
          eventType: c.eventType,
          eventDate: c.eventDate,
          severity: c.severity,
          title: c.title,
          summary: c.summary,
          sourceUrl: licenseUrl(rec.license),
          dedupeKey: `cslb:${rec.license}:${c.key}:${c.eventDate ?? today}`,
        });
        if (added) events++;
      }
    }

    for (const gone of removed) {
      const added = await addEvent(ctx.db, {
        entityId: gone.entityId,
        source: "cslb",
        eventType: "cslb_license_removed",
        eventDate: today,
        severity: "watch",
        title: "Contractor license no longer listed as current",
        summary: "Dropped from the CSLB file of current licenses: expired, cancelled or revoked.",
        sourceUrl: licenseUrl(gone.sourceId),
        dedupeKey: `cslb:${gone.sourceId}:removed:${today}`,
      });
      if (added) events++;
      // Mark it so the next run does not report the same removal again.
      await ctx.db
        .update(entityIdentifiers)
        .set({ raw: { ...gone.raw, removed_on: today } })
        .where(and(eq(entityIdentifiers.source, "cslb"), eq(entityIdentifiers.sourceId, gone.sourceId)));
    }
    return { rowsUpserted, events, meta: { removed: removed.length } };
  },
};
