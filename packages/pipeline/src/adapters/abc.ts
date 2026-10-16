import { abcTypeName } from "@jw/content";
import { entityIdentifiers, eq, type Severity } from "@jw/db";
import { load } from "cheerio";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { entityTypeFromName, isOrganizationName, normalizeName, stableJson, titleCase } from "../normalize";
import { addEvent, type EntityRecord, upsertEntity } from "../resolve";
import { type Adapter, type FetchedFile, type JobContext, download } from "../runner";

// California ABC. The daily export gives every license's current details; the daily reports
// give the dated events (issued, new applications, status changes with transfers and escrow).
export const ABC_EXPORT_URL = "https://www.abc.ca.gov/wp-content/uploads/DailyExport-CSV.zip";
const REPORTS = {
  issued: { path: "issued-licenses", type: 1 },
  applications: { path: "new-applications", type: 2 },
  "status-changes": { path: "status-changes", type: 3 },
} as const;
type ReportKind = keyof typeof REPORTS;
// Reports land late, so each run re-reads the last few report days. Events dedupe.
export const REPORT_DAYS = 3;
const SAN_DIEGO_COUNTY_CODE = "37";

export const reportUrl = (kind: ReportKind, offset: number) =>
  `https://www.abc.ca.gov/licensing/licensing-reports/${REPORTS[kind].path}/?RPTTYPE=${REPORTS[kind].type}&DATEOFFSET=${offset}`;
export const licenseUrl = (license: string) =>
  `https://www.abc.ca.gov/licensing/license-lookup/single-license/?RPTTYPE=12&LICENSE=${license}`;

export interface AbcLicense {
  kind: "license";
  license: string;
  entity: EntityRecord;
}

export interface AbcReportRow {
  kind: "event";
  report: ReportKind;
  reportDate: string;
  license: string;
  typeCode: string;
  status: string;
  statusFrom: string | null;
  action: string | null;
  transfer: string | null;
  escrow: string | null;
  dba: string | null;
  owner: string | null;
  city: string | null;
  zip: string | null;
}

export type AbcRecord = AbcLicense | AbcReportRow;

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// "14-OCT-2026" -> "2026-10-14"
function exportDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  return m && MONTHS[m[2]!] ? `${m[3]}-${MONTHS[m[2]!]}-${m[1]}` : null;
}

const licenseNumber = (s: string) => String(Number.parseInt(s.replace(/\D/g, ""), 10) || "");

function exportRows(body: Uint8Array): Array<Record<string, string>> {
  const files = unzipSync(body);
  const csvName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".csv"));
  if (!csvName) throw new Error("ABC export zip has no CSV file; the format changed");
  let text = new TextDecoder("utf-8").decode(files[csvName]).replace(/^﻿/, "");
  // The first line is a title ("Updated Friday 16th of October 2026"), not the header.
  if (text.startsWith('"Updated')) text = text.slice(text.indexOf("\n") + 1);
  const rows = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>;
  if (rows.length > 0 && !("File Number" in rows[0]! && "Prem County" in rows[0]!)) {
    throw new Error("ABC export has no File Number or Prem County column; the format changed");
  }
  return rows;
}

// One record per San Diego County license, merging its license types.
export function parseExport(body: Uint8Array): AbcLicense[] {
  const byLicense = new Map<string, { rows: Array<Record<string, string>> }>();
  for (const r of exportRows(body)) {
    if (r["Prem County"] !== "SAN DIEGO") continue;
    const license = licenseNumber(r["File Number"] ?? "");
    if (!license) continue;
    const entry = byLicense.get(license) ?? { rows: [] };
    entry.rows.push(r);
    byLicense.set(license, entry);
  }

  const out: AbcLicense[] = [];
  for (const [license, { rows }] of byLicense) {
    const first = rows[0]!;
    const primary = first["Primary Name"] ?? "";
    const dba = first["DBA Name"] ?? "";
    const org = isOrganizationName(primary);
    // An individual licensee is kept only under a trade name that is not their own name.
    if (!org && (!dba || normalizeName(dba) === normalizeName(primary))) continue;
    const name = org ? primary : dba;
    const types = rows
      .map((r) => ({
        code: (r["License Type"] ?? "").padStart(2, "0"),
        status: r["Type Status"] ?? "",
        stage: r["Lic or App"] ?? "",
        issued: exportDate(r["Type Orig Iss Date"] ?? ""),
        expires: exportDate(r["Expir Date"] ?? ""),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    out.push({
      kind: "license",
      license,
      entity: {
        source: "abc",
        sourceId: license,
        name: titleCase(name)!,
        dba: org && dba && normalizeName(dba) !== normalizeName(primary) ? titleCase(dba) : null,
        entityType: org ? entityTypeFromName(primary) : "sole_prop",
        address1: titleCase([first["Prem Addr 1"], first["Prem Addr 2"]].filter(Boolean).join(" ")),
        city: titleCase(first["Prem City"]),
        state: first["Prem State"] || "CA",
        zip: first["Prem Zip"],
        county: "San Diego",
        // Mailing addresses and individual names are never stored.
        raw: {
          license,
          primary_name: org ? primary : null,
          dba_name: dba || null,
          premises_city: first["Prem City"] ?? null,
          premises_zip: first["Prem Zip"] ?? null,
          census_tract: first["Prem Census Tract #"] ?? null,
          district: first.District ?? null,
          types,
          license_type_description: types.map((t) => abcTypeName(t.code) ?? `ABC license type ${t.code}`),
        },
      },
    });
  }
  return out;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Thursday, October 15, 2026" -> "2026-10-15"
function reportDate(text: string): string | null {
  const m = text.match(/([A-Za-z]+) (\d{1,2}), (\d{4})/);
  const month = m ? MONTH_NAMES.indexOf(m[1]!) + 1 : 0;
  return m && month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

// Escrow holders are usually companies; a person's name is dropped.
function escrowCompany(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const name = t.split(/\s\d/)[0]!.trim();
  return /ESCROW|TITLE|BANK|TRUST|INC|LLC|CORP|COMPANY|SERVICES/i.test(name) ? titleCase(name) : null;
}

export function parseReport(kind: ReportKind, html: string): AbcReportRow[] {
  const $ = load(html);
  const date = reportDate($("#rptdate").text());
  const table = $("table#license_report");
  if (!date || table.length === 0) return [];
  const headers = table
    .find("thead th")
    .map((_, th) => $(th).text().replace(/\s+/g, " ").trim())
    .get();
  const col = (name: string) => headers.findIndex((h) => h.startsWith(name));
  if (col("License Number") !== 0 || col("County") < 0) {
    throw new Error(`ABC ${kind} report columns changed: ${headers.join(", ")}`);
  }
  const rows: AbcReportRow[] = [];
  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).children("th, td");
    const cell = (name: string) => {
      const i = col(name);
      return i >= 0 ? cells.eq(i) : null;
    };
    const text = (name: string) => cell(name)?.text().replace(/\s+/g, " ").trim() ?? "";
    if (text("County") !== SAN_DIEGO_COUNTY_CODE) return;
    const license = licenseNumber(text("License Number"));
    if (!license) return;

    const ownerParts = (cell("Primary Owner")?.html() ?? "")
      .split(/<br\s*\/?>/i)
      .map((p) => load(p).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const dbaPart = ownerParts.find((p) => p.startsWith("DBA:"));
    const ownerIndex = dbaPart ? ownerParts.indexOf(dbaPart) + 1 : 0;
    const owner = ownerParts[ownerIndex] ?? null;

    const statusCell = cell("Status");
    const statusLines = (statusCell?.html() ?? "")
      .split(/<br\s*\/?>/i)
      .map((p) => load(p).text().trim())
      .filter(Boolean);
    rows.push({
      kind: "event",
      report: kind,
      reportDate: date,
      license,
      typeCode: text("Type").split("|")[0]!.trim().padStart(2, "0"),
      status: statusLines.at(-1) ?? "",
      statusFrom: kind === "status-changes" ? (statusLines[0] ?? null) : null,
      action: kind === "status-changes" ? null : text("Action") || null,
      transfer: kind === "status-changes" ? text("Transfer") || null : null,
      escrow: escrowCompany(text("Escrow")),
      dba: dbaPart ? dbaPart.replace(/^DBA:\s*/, "").trim() || null : null,
      // Individual licensees are never stored.
      owner: owner && isOrganizationName(owner) ? owner : null,
      city: text("City") || null,
      zip: text("Zip Code") || null,
    });
  });
  return rows;
}

function describeEvent(r: AbcReportRow) {
  const typeName = abcTypeName(r.typeCode) ?? `type ${r.typeCode}`;
  const parts: string[] = [`Type ${r.typeCode}, ${typeName}`];
  if (r.action) parts.push(`action ${r.action}`);
  if (r.transfer) parts.push(`transfer license ${r.transfer}`);
  if (r.escrow) parts.push(`escrow: ${r.escrow}`);
  const watch = ["SUSPEN", "REVPEN", "AUTREV", "REV"].includes(r.status.toUpperCase());
  const severity: Severity = watch ? "watch" : "info";
  if (r.report === "issued") return { eventType: "abc_issued", title: `ABC license issued: ${typeName}`, severity, summary: parts.join("; ") };
  if (r.report === "applications") return { eventType: "abc_application", title: `New ABC license application: ${typeName}`, severity, summary: parts.join("; ") };
  return {
    eventType: "abc_status_change",
    title: `ABC license status ${r.statusFrom ?? "?"} to ${r.status}`,
    severity,
    summary: parts.join("; "),
  };
}

async function entityForLicense(ctx: JobContext, r: AbcReportRow, known: Map<string, string>): Promise<string | null> {
  const id = known.get(r.license);
  if (id) return id;
  const name = r.owner ?? r.dba;
  if (!name) return null;
  const { entityId } = await upsertEntity(
    ctx.db,
    {
      source: "abc",
      sourceId: r.license,
      name: titleCase(name)!,
      dba: r.owner && r.dba ? titleCase(r.dba) : null,
      entityType: r.owner ? null : "sole_prop",
      city: titleCase(r.city),
      zip: r.zip,
      county: "San Diego",
      raw: { license: r.license, dba_name: r.dba, primary_name: r.owner, license_type_description: [abcTypeName(r.typeCode)] },
    },
    ctx.now,
  );
  known.set(r.license, entityId);
  return entityId;
}

export const abc: Adapter<AbcRecord> = {
  name: "abc",
  source: "abc",
  async fetch(ctx) {
    const files: FetchedFile[] = [await download(ctx, ABC_EXPORT_URL, "DailyExport-CSV.zip")];
    for (const kind of Object.keys(REPORTS) as ReportKind[]) {
      for (let offset = 0; offset < REPORT_DAYS; offset++) {
        files.push(await download(ctx, reportUrl(kind, offset), `${kind}-${offset}.html`));
      }
    }
    return files;
  },
  parse(files) {
    const out: AbcRecord[] = [];
    for (const f of files) {
      if (f.name.endsWith(".zip")) out.push(...parseExport(f.body));
      else {
        const kind = f.name.replace(/-\d+\.html$/, "") as ReportKind;
        if (kind in REPORTS) out.push(...parseReport(kind, new TextDecoder().decode(f.body)));
      }
    }
    return out;
  },
  async upsert(records, ctx) {
    // Only licenses that are new or changed are written, so the daily run stays quick.
    const existing = await ctx.db
      .select({ sourceId: entityIdentifiers.sourceId, entityId: entityIdentifiers.entityId, raw: entityIdentifiers.raw })
      .from(entityIdentifiers)
      .where(eq(entityIdentifiers.source, "abc"));
    const known = new Map(existing.map((e) => [e.sourceId, e.entityId]));
    const rawBySource = new Map(existing.map((e) => [e.sourceId, stableJson(e.raw)]));

    let rowsUpserted = 0;
    for (const r of records) {
      if (r.kind !== "license") continue;
      if (rawBySource.get(r.license) === stableJson(r.entity.raw)) continue;
      const { entityId } = await upsertEntity(ctx.db, r.entity, ctx.now);
      known.set(r.license, entityId);
      rowsUpserted++;
    }

    let events = 0;
    for (const r of records) {
      if (r.kind !== "event") continue;
      const entityId = await entityForLicense(ctx, r, known);
      if (!entityId) continue;
      const d = describeEvent(r);
      const added = await addEvent(ctx.db, {
        entityId,
        source: "abc",
        eventType: d.eventType,
        eventDate: r.reportDate,
        severity: d.severity,
        title: d.title,
        summary: d.summary,
        sourceUrl: licenseUrl(r.license),
        raw: { ...r, owner: r.owner },
        dedupeKey: `abc:${r.report}:${r.license}:${r.typeCode}:${r.reportDate}:${r.statusFrom ?? ""}:${r.status}`,
      });
      if (added) events++;
    }
    return { rowsUpserted, events };
  },
};
