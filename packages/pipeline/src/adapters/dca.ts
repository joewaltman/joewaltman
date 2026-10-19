import { dcaLicenseTypes } from "@jw/content";
import { type Severity, and, desc, entityIdentifiers, eq, jobRuns, sql } from "@jw/db";
import { archiveKey } from "../archive";
import { entityTypeFromName, looksLikePerson, stableJson, titleCase } from "../normalize";

export { looksLikePerson };
import { type EntityRecord, addEvent, upsertEntity } from "../resolve";
import { type Job, type JobContext, download } from "../runner";
import { pacificDay } from "../schedule";
import { excelDate, xlsxRows } from "../xlsx";

// California Department of Consumer Affairs license files: one tab-separated file (named .xls)
// per board, posted monthly to a public Box folder linked from the DCA public information page.
// Only organization rows in San Diego County, of the license types in content/dca-license-types.json,
// are kept. Events come from comparing each month's file with the last.
export const DCA_SHARED = "oss6hf8jys2bmgxqd2gdz7w4oepm2il9";
const BOX = "https://dca.box.com";
export const DCA_SEARCH_URL = "https://search.dca.ca.gov/";
const NEW_LICENSE_DAYS = 45;
const MAX_REMOVED_SHARE = 0.1;

export interface BoxItem {
  id: number;
  type: "folder" | "file";
  name: string;
  size: number;
  updated: number;
}

export const folderUrl = (id: number | null, page = 1) =>
  `${BOX}/s/${DCA_SHARED}${id ? `/folder/${id}` : ""}${page > 1 ? `?page=${page}` : ""}`;
export const fileUrl = (id: number) => `${BOX}/index.php?rm=box_download_shared_file&shared_name=${DCA_SHARED}&file_id=f_${id}`;

// The listing Box embeds in a shared folder's page.
export function parseBoxListing(html: string): { items: BoxItem[]; pageCount: number } {
  const m = html.match(/Box\.postStreamData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error("DCA Box page has no folder listing; Box changed its page format");
  const data = JSON.parse(m[1]!) as Record<string, { pageCount?: number; items?: Array<Record<string, unknown>> }>;
  const folder = data["/app-api/enduserapp/shared-folder"];
  if (!folder?.items) throw new Error("DCA Box page listing has no items");
  return {
    pageCount: folder.pageCount ?? 1,
    items: folder.items.map((it) => ({
      id: Number(it.id),
      type: it.type === "folder" ? "folder" : "file",
      name: String(it.name),
      size: Number(it.itemSize ?? 0),
      updated: Number(it.contentUpdated ?? 0),
    })),
  };
}

async function listFolder(ctx: JobContext, id: number | null): Promise<BoxItem[]> {
  const items: BoxItem[] = [];
  for (let page = 1; page <= 10; page++) {
    const html = new TextDecoder().decode((await download(ctx, folderUrl(id, page), "listing.html")).body);
    const listing = parseBoxListing(html);
    items.push(...listing.items);
    if (page >= listing.pageCount) break;
  }
  return items;
}

const DATA_FILE = /_Data\d+\.(xls|xlsx|txt|csv|tsv)$/i;

export interface DcaRecord {
  sourceId: string;
  folder: string;
  agency: string;
  licenseType: string;
  license: string;
  status: string;
  issued: string | null;
  entity: EntityRecord;
}

// "08-25-2025" -> "2025-08-25"
const date = (s: string | undefined) => {
  const m = (s ?? "").trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

// "COX ADVANCED SERVICES CALIFORNIA, LLC D/B/A COX HOME SECURITY" -> legal name and trade name.
export function splitDba(name: string): { name: string; dba: string | null } {
  const [legal, trade] = name.split(/\s+(?:D\/B\/A|DBA|D\.B\.A\.)\s+/i);
  return { name: legal!.trim(), dba: trade?.trim() || null };
}

// Rows from one data file: the header names the columns, which differ a little between boards.
export function parseDca(body: Uint8Array, folder: string): DcaRecord[] {
  const config = dcaLicenseTypes.folders[folder];
  if (!config) return [];
  const lines = new TextDecoder("utf-8").decode(body).split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const c = {
    type: col("License Type"),
    number: col("License Number"),
    kind: col("Indiv/Org"),
    name: col("Org/Last Name"),
    a1: col("Address Line 1"),
    a2: col("Address Line 2"),
    city: col("City"),
    county: col("County"),
    state: col("State"),
    zip: col("Zip"),
    issued: col("Original Issue Date"),
    expires: col("Expiration Date"),
    status: col("License Status"),
  };
  const missing = Object.entries(c).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length > 0) throw new Error(`DCA ${folder} file is missing columns: ${missing.join(", ")}; the format changed`);

  const out: DcaRecord[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split("\t").map((v) => v.trim());
    if (f[c.kind] !== "O" || (f[c.county] ?? "").toUpperCase() !== "SAN DIEGO") continue;
    const licenseType = f[c.type] ?? "";
    const type = config.types[licenseType];
    const license = f[c.number] ?? "";
    const rawName = f[c.name] ?? "";
    if (!type || !license || !rawName || looksLikePerson(rawName)) continue;
    const { name, dba } = splitDba(rawName);
    const sourceId = `${folder}:${licenseType}:${license}`;
    const status = f[c.status] ?? "";
    const issued = date(f[c.issued]);
    const raw = { agency: config.agency, license_type: licenseType, license, status, issued, expires: date(f[c.expires]) };
    out.push({
      sourceId,
      folder,
      agency: config.agency,
      licenseType,
      license,
      status,
      issued,
      entity: {
        source: "dca",
        sourceId,
        name: titleCase(name) ?? name,
        dba: dba ? titleCase(dba) : null,
        entityType: entityTypeFromName(name),
        status: status || null,
        address1: type.premises ? titleCase(f[c.a1]) : null,
        address2: type.premises ? titleCase(f[c.a2]) : null,
        city: titleCase(f[c.city]),
        state: f[c.state] || "CA",
        zip: f[c.zip] ?? null,
        county: "San Diego",
        naics: type.naics,
        raw,
      },
    });
  }
  return out;
}

// Some boards name columns differently; these map onto the names the text files use.
const HEADER_ALIASES: Record<string, string> = {
  "License Type Name": "License Type",
  "Address Line1": "Address Line 1",
  "Address Line2": "Address Line 2",
  "Zip Code": "Zip",
};
// Columns naming people (a licensee's relationships), never kept.
const DROP_COLUMNS = new Set(["Relationship Name", "Relationship Name Part B"]);

// The header plus San Diego County organization rows, as tab-separated text: what the job parses
// and archives. The full statewide files run to 100 MB and include individual licensees.
export function sanDiegoOrganizations(rows: string[][]): Uint8Array {
  const header = (rows[0] ?? []).map((h) => HEADER_ALIASES[h.trim()] ?? h.trim());
  const keep = header.map((h, i) => (DROP_COLUMNS.has(h) ? -1 : i)).filter((i) => i >= 0);
  const county = header.indexOf("County");
  const kind = header.indexOf("Indiv/Org");
  const dates = new Set(header.flatMap((h, i) => (/Date$/.test(h) ? [i] : [])));
  const out = [keep.map((i) => header[i]).join("\t")];
  for (const r of rows.slice(1)) {
    if ((r[county] ?? "").trim().toUpperCase() !== "SAN DIEGO" || (r[kind] ?? "").trim() !== "O") continue;
    out.push(keep.map((i) => (dates.has(i) && /^\d+(\.\d+)?$/.test(r[i] ?? "") ? excelDate(r[i]!) : (r[i] ?? "").replace(/[\t\r\n]+/g, " "))).join("\t"));
  }
  return new TextEncoder().encode(out.join("\n"));
}

// A board's data file as rows: DCA's tab-separated ".xls" text, or a real .xlsx workbook.
export function dcaRows(name: string, body: Uint8Array): string[][] {
  if (/\.xlsx$/i.test(name)) return xlsxRows(body);
  return new TextDecoder("windows-1252").decode(body).split(/\r?\n/).filter((l) => l.length > 0).map((l) => l.split("\t"));
}

const isGood = (status: string) => /^(active|current)$/i.test(status.trim());

interface Change {
  eventType: string;
  severity: Severity;
  title: string;
  summary: string;
  eventDate: string | null;
  key: string;
}

export function dcaChanges(rec: DcaRecord, before: Record<string, unknown> | null, today: string): Change[] {
  const where = `${rec.agency}, license ${rec.license}`;
  if (!before) {
    const cutoff = pacificDay(new Date(new Date(`${today}T12:00:00Z`).getTime() - NEW_LICENSE_DAYS * 86_400_000));
    if (rec.issued && rec.issued >= cutoff) {
      // DCA posts its files about a month behind, so the event is dated the day the license first
      // appears here, which puts it in that week's Radar. The issue date stays in the note.
      return [{ eventType: "new_business", severity: "info", title: `New state license: ${rec.licenseType}`, summary: `Issued ${rec.issued}. ${where}`, eventDate: today, key: "new" }];
    }
    return [];
  }
  if (String(before.status ?? "") !== rec.status) {
    return [
      {
        eventType: "dca_status_change",
        severity: isGood(rec.status) ? "info" : "watch",
        title: `${rec.licenseType} license status: ${String(before.status || "unknown")} to ${rec.status || "unknown"}`,
        summary: where,
        eventDate: today,
        key: `status:${rec.status}`,
      },
    ];
  }
  return [];
}

export function dcaJob(): Job {
  return {
    name: "dca",
    async run(ctx) {
      const today = pacificDay(ctx.now);
      // The Box version of each data file processed last time; only changed folders are read again.
      const [last] = await ctx.db
        .select({ meta: jobRuns.meta })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, "dca"), eq(jobRuns.status, "success")))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      const versions: Record<string, number> = { ...((last?.meta?.versions as Record<string, number> | undefined) ?? {}) };

      const root = await listFolder(ctx, null);
      const wanted = Object.keys(dcaLicenseTypes.folders);
      const missingFolders = wanted.filter((w) => !root.some((r) => r.type === "folder" && r.name === w));
      let rowsIn = 0;
      let rowsUpserted = 0;
      let events = 0;
      const processed: string[] = [];
      const archived: string[] = [];

      for (const folder of root.filter((r) => r.type === "folder" && wanted.includes(r.name))) {
        const files = (await listFolder(ctx, folder.id)).filter((f) => f.type === "file" && DATA_FILE.test(f.name));
        if (files.length === 0) continue;
        if (files.every((f) => versions[`${folder.name}/${f.name}`] === f.updated)) continue;

        const records: DcaRecord[] = [];
        for (const f of files) {
          const file = await download(ctx, fileUrl(f.id), f.name, undefined, 600_000);
          const local = sanDiegoOrganizations(dcaRows(f.name, file.body));
          archived.push(await ctx.archive.put(archiveKey("dca", today, `${folder.name}_${f.name}`), local));
          records.push(...parseDca(local, folder.name));
        }
        rowsIn += records.length;

        const existing = await ctx.db
          .select({ sourceId: entityIdentifiers.sourceId, entityId: entityIdentifiers.entityId, raw: entityIdentifiers.raw })
          .from(entityIdentifiers)
          .where(and(eq(entityIdentifiers.source, "dca"), sql`${entityIdentifiers.sourceId} like ${`${folder.name}:%`}`));
        const before = new Map(existing.map((e) => [e.sourceId, e]));
        const present = new Set(records.map((r) => r.sourceId));
        const current = existing.filter((e) => !e.raw.removed_on);
        const removed = current.filter((e) => !present.has(e.sourceId));
        if (current.length > 200 && removed.length > current.length * MAX_REMOVED_SHARE) {
          throw new Error(`DCA ${folder.name}: ${removed.length} of ${current.length} known licenses are missing; refusing to record that many removals`);
        }

        for (const rec of records) {
          const prev = before.get(rec.sourceId);
          if (prev && stableJson(prev.raw) === stableJson(rec.entity.raw)) continue;
          const { entityId } = await upsertEntity(ctx.db, rec.entity, ctx.now);
          rowsUpserted++;
          for (const c of dcaChanges(rec, prev?.raw ?? null, today)) {
            if (
              await addEvent(ctx.db, {
                entityId,
                source: "dca",
                eventType: c.eventType,
                eventDate: c.eventDate,
                severity: c.severity,
                title: c.title,
                summary: c.summary,
                sourceUrl: DCA_SEARCH_URL,
                raw: { license: rec.license, licenseType: rec.licenseType, agency: rec.agency },
                dedupeKey: `dca:${rec.sourceId}:${c.key}:${c.eventDate ?? today}`,
              })
            )
              events++;
          }
        }
        for (const gone of removed) {
          const raw = gone.raw as { license_type?: string; license?: string; agency?: string };
          if (
            await addEvent(ctx.db, {
              entityId: gone.entityId,
              source: "dca",
              eventType: "dca_license_removed",
              eventDate: today,
              severity: "watch",
              title: `${raw.license_type ?? "State"} license no longer in the DCA file`,
              summary: `${raw.agency ?? "DCA"}, license ${raw.license ?? ""}`,
              sourceUrl: DCA_SEARCH_URL,
              dedupeKey: `dca:${gone.sourceId}:removed:${today}`,
            })
          )
            events++;
          await ctx.db
            .update(entityIdentifiers)
            .set({ raw: { ...gone.raw, removed_on: today } })
            .where(and(eq(entityIdentifiers.source, "dca"), eq(entityIdentifiers.sourceId, gone.sourceId)));
        }
        for (const f of files) versions[`${folder.name}/${f.name}`] = f.updated;
        processed.push(folder.name);
        ctx.log(`dca: ${folder.name}: ${records.length} San Diego organization licenses, ${removed.length} removed`);
      }
      return { rowsIn, rowsUpserted, events, meta: { versions, processed, missingFolders, archived } };
    },
  };
}
