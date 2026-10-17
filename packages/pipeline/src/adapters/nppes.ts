import { countyForZip, npiGroup } from "@jw/content";
import { and, desc, entityIdentifiers, eq, jobRuns } from "@jw/db";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { archiveKey } from "../archive";
import { looksLikePerson, titleCase, zip5 } from "../normalize";
import { addEvent, upsertEntity } from "../resolve";
import { type Job, download } from "../runner";
import { pacificDay } from "../schedule";

// CMS NPPES weekly files: every NPI created or changed that week. Only organizations (entity type 2)
// practicing in San Diego County are kept; individual providers are never read. New organization
// NPIs are new practices for the Radar; deactivations of known ones go to the Watchlist.
export const NPI_FILES_PAGE = "https://download.cms.gov/nppes/NPI_Files.html";
const BASE = "https://download.cms.gov/nppes/";
export const npiRecordUrl = (npi: string) => `https://npiregistry.cms.hhs.gov/provider-view/${npi}`;
const NEW_DAYS = 45;
const WEEKLY = /NPPES_Data_Dissemination_(\d{6})_(\d{6})_Weekly(?:_V2)?\.zip/i;

// Weekly file names on the downloads page, oldest first. "100526_101126" is October 5 to 11, 2026.
export function weeklyFiles(html: string): Array<{ name: string; url: string; end: string }> {
  const seen = new Map<string, { name: string; url: string; end: string }>();
  for (const m of html.matchAll(/href=["']?([^"' >]+)/gi)) {
    const href = m[1]!;
    const w = href.match(WEEKLY);
    if (!w) continue;
    const name = w[0];
    const end = `20${w[2]!.slice(4, 6)}-${w[2]!.slice(0, 2)}-${w[2]!.slice(2, 4)}`;
    seen.set(name, { name, url: new URL(href, BASE).toString(), end });
  }
  return [...seen.values()].sort((a, b) => a.end.localeCompare(b.end));
}

const date = (s: string | undefined) => {
  const m = (s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};
const value = (s: string | undefined) => {
  const v = (s ?? "").trim();
  return v && v !== "<UNAVAIL>" ? v : null;
};

type Row = Record<string, string>;
const ORG = "Provider Organization Name (Legal Business Name)";
const OTHER = "Provider Other Organization Name";
const STREET = "Provider First Line Business Practice Location Address";
const STREET2 = "Provider Second Line Business Practice Location Address";
const CITY = "Provider Business Practice Location Address City Name";
const STATE = "Provider Business Practice Location Address State Name";
const ZIP = "Provider Business Practice Location Address Postal Code";
const PHONE = "Provider Business Practice Location Address Telephone Number";

export interface NpiRow {
  npi: string;
  kind: "organization" | "deactivated";
  name: string | null;
  dba: string | null;
  taxonomy: string | null;
  enumerated: string | null;
  deactivated: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  zip: string | null;
  phone: string | null;
  subpart: boolean;
}

// Organizations in San Diego County, plus any deactivated NPI (those rows carry no address).
export function parseNpiData(csv: Uint8Array): NpiRow[] {
  const out: NpiRow[] = [];
  let checked = false;
  parse(Buffer.from(csv), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    on_record: (r: Row) => {
      if (!checked) {
        for (const col of ["NPI", "Entity Type Code", ORG, ZIP, "Provider Enumeration Date", "NPI Deactivation Date", "Healthcare Provider Taxonomy Code_1"]) {
          if (!(col in r)) throw new Error(`NPPES weekly file has no "${col}" column; the format changed`);
        }
        checked = true;
      }
      const npi = (r.NPI ?? "").trim();
      if (!npi) return null;
      const deactivated = date(r["NPI Deactivation Date"]);
      if (deactivated && !value(r["Entity Type Code"])) {
        out.push({ npi, kind: "deactivated", name: null, dba: null, taxonomy: null, enumerated: null, deactivated, street: null, street2: null, city: null, zip: null, phone: null, subpart: false });
        return null;
      }
      if (r["Entity Type Code"] !== "2" || r[STATE] !== "CA") return null;
      const zip = zip5(r[ZIP]);
      if (!zip || countyForZip(zip) !== "San Diego") return null;
      out.push({
        npi,
        kind: "organization",
        name: value(r[ORG]),
        dba: value(r[OTHER]),
        taxonomy: value(r["Healthcare Provider Taxonomy Code_1"]),
        enumerated: date(r["Provider Enumeration Date"]),
        deactivated,
        street: value(r[STREET]),
        street2: value(r[STREET2]),
        city: value(r[CITY]),
        zip,
        phone: value(r[PHONE]),
        subpart: r["Is Organization Subpart"] === "Y",
      });
      return null;
    },
  });
  return out;
}

export function nppesJob(): Job {
  return {
    name: "nppes",
    async run(ctx) {
      const today = pacificDay(ctx.now);
      const cutoff = pacificDay(new Date(ctx.now.getTime() - NEW_DAYS * 86_400_000));
      const [last] = await ctx.db
        .select({ meta: jobRuns.meta })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, "nppes"), eq(jobRuns.status, "success")))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      const done = new Set((last?.meta?.processed as string[] | undefined) ?? []);
      const page = new TextDecoder().decode((await download(ctx, NPI_FILES_PAGE, "NPI_Files.html")).body);
      const all = weeklyFiles(page);
      if (all.length === 0) throw new Error("NPPES downloads page lists no weekly files; the page changed");
      // The first run reads only the latest week and counts the older ones as done; after that,
      // every week not yet read.
      if (done.size === 0) for (const f of all.slice(0, -1)) done.add(f.name);
      const todo = all.filter((f) => !done.has(f.name));

      let rowsIn = 0;
      let rowsUpserted = 0;
      let events = 0;
      const archived: string[] = [];
      for (const f of todo) {
        const zip = unzipSync((await download(ctx, f.url, f.name, undefined, 300_000)).body);
        const dataName = Object.keys(zip).find((n) => /^npidata_pfile_.*(?<!fileheader)\.csv$/i.test(n));
        if (!dataName) throw new Error(`${f.name} has no npidata file`);
        const rows = parseNpiData(zip[dataName]!);
        rowsIn += rows.length;
        archived.push(await ctx.archive.put(archiveKey("nppes", today, `${f.name}.json`), new TextEncoder().encode(JSON.stringify(rows))));

        for (const r of rows) {
          if (r.kind === "deactivated") {
            const [known] = await ctx.db
              .select({ entityId: entityIdentifiers.entityId })
              .from(entityIdentifiers)
              .where(and(eq(entityIdentifiers.source, "nppes"), eq(entityIdentifiers.sourceId, r.npi)))
              .limit(1);
            if (known && (await addEvent(ctx.db, { entityId: known.entityId, source: "nppes", eventType: "npi_deactivated", eventDate: r.deactivated, severity: "watch", title: "NPI deactivated", summary: `NPI ${r.npi}`, sourceUrl: npiRecordUrl(r.npi), dedupeKey: `nppes:${r.npi}:deactivated:${r.deactivated}` }))) events++;
            continue;
          }
          const group = npiGroup(r.taxonomy);
          if (!r.name || !group || group.skip || looksLikePerson(r.name)) continue;
          const result = await upsertEntity(
            ctx.db,
            {
              source: "nppes",
              sourceId: r.npi,
              name: titleCase(r.name) ?? r.name,
              dba: r.dba ? titleCase(r.dba) : null,
              address1: titleCase(r.street),
              address2: titleCase(r.street2),
              city: titleCase(r.city),
              state: "CA",
              zip: r.zip,
              county: "San Diego",
              naics: group.naics,
              phone: r.phone,
              raw: { npi: r.npi, taxonomy: r.taxonomy, enumerated: r.enumerated, subpart: r.subpart },
            },
            ctx.now,
          );
          rowsUpserted++;
          if (!result.previousRaw && r.enumerated && r.enumerated >= cutoff) {
            if (
              await addEvent(ctx.db, {
                entityId: result.entityId,
                source: "nppes",
                eventType: "new_business",
                eventDate: r.enumerated,
                severity: "info",
                title: `New ${group.label} registered (NPI)`,
                summary: `NPI ${r.npi}${r.subpart ? ", a new location of an existing organization" : ""}`,
                sourceUrl: npiRecordUrl(r.npi),
                dedupeKey: `nppes:${r.npi}:new`,
              })
            )
              events++;
          }
        }
        done.add(f.name);
        ctx.log(`nppes: ${f.name}: ${rows.length} San Diego organization or deactivation rows`);
      }
      // Keep the list short: weeks drop off the downloads page after a few months.
      const processed = all.filter((f) => done.has(f.name)).map((f) => f.name);
      return { rowsIn, rowsUpserted, events, meta: { processed, read: todo.map((f) => f.name), archived } };
    },
  };
}
