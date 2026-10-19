import { type DropSourceConfig, type DropTypeConfig, manualDropSources } from "@jw/content";
import { type Db, type DropSource, type Severity, type Source, and, entities, entityIdentifiers, eq, or } from "@jw/db";
import { entityTypeFrom, entityTypeFromName, isOrganizationName, looksLikePerson, normalizeName, stableJson, titleCase, zip5 } from "../normalize";
import { addEvent, upsertEntity } from "../resolve";
import { pacificDay } from "../schedule";
import { type ColumnMap, detectDelimiter, mapColumns, parseDate, splitLine } from "./table";

const NEW_DAYS = 45;
const IDENTIFIER_SOURCE: Record<DropSource, Source> = {
  sos: "sos",
  ucc: "ucc",
  dlse_judgments: "dlse",
  dlse_debarment: "dlse",
  recorder: "recorder",
  fbn: "fbn",
};

export interface DropResult {
  rows: number;
  upserted: number;
  events: number;
  // Rows left out, by reason, so a bad mapping shows up on the admin page.
  skipped: Record<string, number>;
  matched: Record<string, string>;
}

// Liens, judgments and filings are only ever recorded against businesses.
const isBusiness = (name: string) => Boolean(name) && (isOrganizationName(name) || entityTypeFromName(name) !== null) && !looksLikePerson(name);

interface Row {
  get(field: string): string;
}

// Finds the entity a filing is about. With a ZIP, the usual name-and-ZIP match. Without one, a
// business with exactly that name in San Diego County, or else one entity per name for this source.
async function attach(
  db: Db,
  source: Source,
  key: string,
  rec: { name: string; dba?: string | null; city?: string | null; zip?: string | null; address1?: string | null; entityType?: ReturnType<typeof entityTypeFromName>; status?: string | null; formedAt?: string | null; raw: Record<string, unknown> },
  now: Date,
): Promise<{ entityId: string; previousRaw: Record<string, unknown> | null }> {
  const base = { source, name: titleCase(rec.name) ?? rec.name, dba: rec.dba ? titleCase(rec.dba) : null, city: rec.city ? titleCase(rec.city) : null, zip: rec.zip ?? null, address1: rec.address1 ? titleCase(rec.address1) : null, entityType: rec.entityType ?? null, status: rec.status ?? null, formedAt: rec.formedAt ?? null, raw: rec.raw };
  if (zip5(rec.zip)) {
    const r = await upsertEntity(db, { ...base, sourceId: key }, now);
    return { entityId: r.entityId, previousRaw: r.previousRaw };
  }
  const norm = normalizeName(rec.name);
  const byName = `name:${norm}`;
  const [known] = await db
    .select({ entityId: entityIdentifiers.entityId, raw: entityIdentifiers.raw })
    .from(entityIdentifiers)
    .where(and(eq(entityIdentifiers.source, source), eq(entityIdentifiers.sourceId, byName)))
    .limit(1);
  if (known) return { entityId: known.entityId, previousRaw: known.raw };
  const hits = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.county, "San Diego"), or(eq(entities.normalizedName, norm), eq(entities.normalizedDba, norm))))
    .limit(2);
  if (hits.length === 1) {
    await db.insert(entityIdentifiers).values({ entityId: hits[0]!.id, source, sourceId: byName, raw: rec.raw, firstSeen: now, lastSeen: now }).onConflictDoNothing();
    return { entityId: hits[0]!.id, previousRaw: null };
  }
  const r = await upsertEntity(db, { ...base, sourceId: byName }, now);
  return { entityId: r.entityId, previousRaw: r.previousRaw };
}

const pickType = (types: DropTypeConfig[] | undefined, text: string) => types?.find((t) => text.toUpperCase().includes(t.match.toUpperCase())) ?? null;

function sosSeverity(config: DropSourceConfig, status: string): Severity {
  const s = status.toUpperCase();
  if (config.statuses?.serious.some((x) => s.includes(x))) return "serious";
  if (config.statuses?.watch.some((x) => s.includes(x))) return "watch";
  return "info";
}

export async function processDrop(db: Db, source: DropSource, text: string, now: Date): Promise<DropResult> {
  const config = manualDropSources.sources[source]!;
  const lines = text.split("\n").filter((l) => l.trim());
  const delimiter = detectDelimiter(lines[0] ?? "");
  const header = splitLine(lines[0] ?? "", delimiter);
  const map: ColumnMap = mapColumns(config, header);
  const result: DropResult = { rows: 0, upserted: 0, events: 0, skipped: {}, matched: map.matched };
  if (map.missing.length > 0) throw new Error(`missing columns ${map.missing.join(", ")}`);
  const skip = (why: string) => {
    result.skipped[why] = (result.skipped[why] ?? 0) + 1;
  };
  const today = pacificDay(now);
  const recentCutoff = pacificDay(new Date(now.getTime() - NEW_DAYS * 86_400_000));
  const idSource = IDENTIFIER_SOURCE[source];
  const event = async (entityId: string, e: { eventType: string; severity: Severity; title: string; summary: string | null; eventDate: string | null; key: string; raw?: Record<string, unknown> }) => {
    if (await addEvent(db, { entityId, source: idSource, eventType: e.eventType, eventDate: e.eventDate, severity: e.severity, title: e.title, summary: e.summary, sourceUrl: config.recordUrl, raw: e.raw ?? {}, dedupeKey: `${source}:${e.key}` })) result.events++;
  };

  for (const line of lines.slice(1)) {
    const cells = splitLine(line, delimiter);
    const row: Row = { get: (f) => (map.cols[f] !== undefined ? (cells[map.cols[f]!] ?? "").trim() : "") };
    result.rows++;

    if (source === "sos") {
      const number = row.get("entityNumber");
      const name = row.get("name");
      if (!number || !name) {
        skip("no number or name");
        continue;
      }
      const status = row.get("status");
      const formedAt = parseDate(row.get("formedAt"));
      const siFiledAt = parseDate(row.get("siFiledAt"));
      const entityType = entityTypeFrom(row.get("entityType")) ?? entityTypeFromName(name);
      const raw = { entity_number: number, entity_type: row.get("entityType") || null, status: status || null, formed_at: formedAt, jurisdiction: row.get("jurisdiction") || null, si_filed_at: siFiledAt };
      const r = await upsertEntity(
        db,
        { source: "sos", sourceId: number, name: titleCase(name) ?? name, entityType, status: status || null, formedAt, address1: titleCase(row.get("address1")), city: titleCase(row.get("city")), state: row.get("state") || "CA", zip: row.get("zip") || null, county: row.get("county") ? titleCase(row.get("county")) : null, raw },
        now,
      );
      result.upserted++;
      const before = r.previousRaw;
      if (before && stableJson(before) === stableJson(raw)) continue;
      const kind = row.get("entityType") || "business entity";
      if (!before) {
        if (formedAt && formedAt >= recentCutoff) await event(r.entityId, { eventType: "new_business", severity: "info", title: `New California ${kind.toLowerCase()} registered`, summary: `Secretary of State entity ${number}`, eventDate: formedAt, key: `${number}:new` });
        continue;
      }
      if (String(before.status ?? "") !== (status || "")) {
        await event(r.entityId, { eventType: "sos_status_change", severity: sosSeverity(config, status), title: `Secretary of State status: ${String(before.status || "unknown")} to ${status || "unknown"}`, summary: `Entity ${number}`, eventDate: today, key: `${number}:status:${status}:${today}` });
      }
      if (siFiledAt && siFiledAt !== before.si_filed_at) {
        await event(r.entityId, { eventType: "sos_statement_of_information", severity: "info", title: "Statement of information filed", summary: `Entity ${number}`, eventDate: siFiledAt, key: `${number}:si:${siFiledAt}` });
      }
      continue;
    }

    if (source === "ucc") {
      const number = row.get("filingNumber");
      const debtor = row.get("debtorName");
      if (!number) {
        skip("no filing number");
        continue;
      }
      if (!isBusiness(debtor)) {
        skip("debtor not a business");
        continue;
      }
      const type = pickType(config.types, row.get("filingType"));
      if (!type) {
        skip("unlisted filing type");
        continue;
      }
      const filed = parseDate(row.get("filingDate"));
      const lapse = parseDate(row.get("lapseDate"));
      const secured = row.get("securedParty");
      const securedShown = secured && isBusiness(secured) ? secured : null;
      const { entityId } = await attach(db, "ucc", `filing:${number}`, { name: debtor, city: row.get("debtorCity"), zip: row.get("debtorZip"), address1: row.get("debtorAddress"), entityType: entityTypeFromName(debtor), raw: { filing_number: number, filing_type: row.get("filingType") || null } }, now);
      result.upserted++;
      const summary = [`Filing ${number}`, securedShown ? `secured party ${titleCase(securedShown)}` : null, lapse ? `lapses ${lapse}` : null].filter(Boolean).join(", ");
      await event(entityId, { eventType: type.eventType, severity: type.severity, title: type.title, summary, eventDate: filed, key: `${number}:${type.eventType}:${normalizeName(debtor)}`, raw: { filingNumber: number, filingType: row.get("filingType") || null } });
      continue;
    }

    if (source === "dlse_judgments") {
      const caseNumber = row.get("caseNumber");
      const employer = row.get("employerName");
      if (!caseNumber || !isBusiness(employer)) {
        skip(caseNumber ? "employer not a business" : "no case number");
        continue;
      }
      const { entityId } = await attach(db, "dlse", `case:${caseNumber}`, { name: employer, city: row.get("city"), zip: row.get("zip"), entityType: entityTypeFromName(employer), raw: { case_number: caseNumber } }, now);
      result.upserted++;
      const summary = [`Case ${caseNumber}`, row.get("amount") ? `amount ${row.get("amount")}` : null, row.get("status") || null].filter(Boolean).join(", ");
      await event(entityId, { eventType: "dlse_judgment", severity: "serious", title: "Labor Commissioner judgment entered", summary, eventDate: parseDate(row.get("date")), key: `${caseNumber}:${normalizeName(employer)}` });
      continue;
    }

    if (source === "dlse_debarment") {
      const name = row.get("name");
      const license = row.get("license").replace(/\D/g, "");
      if (!isBusiness(name) && !license) {
        skip("not a business");
        continue;
      }
      // A CSLB license number ties the debarment to the contractor's record directly.
      let entityId: string | null = null;
      if (license) {
        const [hit] = await db.select({ entityId: entityIdentifiers.entityId }).from(entityIdentifiers).where(and(eq(entityIdentifiers.source, "cslb"), eq(entityIdentifiers.sourceId, license))).limit(1);
        entityId = hit?.entityId ?? null;
      }
      if (!entityId) {
        if (!isBusiness(name)) {
          skip("not a business");
          continue;
        }
        entityId = (await attach(db, "dlse", `debarment:${normalizeName(name)}`, { name, city: row.get("city"), zip: row.get("zip"), entityType: entityTypeFromName(name), raw: { license: license || null } }, now)).entityId;
      }
      result.upserted++;
      const start = parseDate(row.get("startDate"));
      const end = parseDate(row.get("endDate"));
      await event(entityId, { eventType: "dlse_debarment", severity: "serious", title: "Debarred from public works projects", summary: [start && end ? `${start} to ${end}` : start ? `from ${start}` : null, license ? `CSLB license ${license}` : null].filter(Boolean).join(", ") || null, eventDate: start, key: `${normalizeName(name) || license}:${start ?? ""}` });
      continue;
    }

    if (source === "recorder") {
      const doc = row.get("documentNumber");
      const type = pickType(config.types, row.get("documentType"));
      if (!doc || !type) {
        skip(doc ? "unlisted document type" : "no document number");
        continue;
      }
      const party = row.get(type.subject ?? "grantor");
      const names = party.split(/\s*;\s*/).filter(isBusiness);
      if (names.length === 0) {
        skip("party not a business");
        continue;
      }
      for (const name of names) {
        const { entityId } = await attach(db, "recorder", `doc:${doc}:${normalizeName(name)}`, { name, entityType: entityTypeFromName(name), raw: { document_number: doc, document_type: row.get("documentType") } }, now);
        result.upserted++;
        await event(entityId, { eventType: type.eventType, severity: type.severity, title: type.title, summary: `Document ${doc}, ${titleCase(row.get("documentType"))}`, eventDate: parseDate(row.get("recordedAt")), key: `${doc}:${normalizeName(name)}` });
      }
      continue;
    }

    if (source === "fbn") {
      const number = row.get("fileNumber");
      const business = row.get("businessName");
      // A fictitious business name is a trade name by definition, so it is kept as written.
      if (!number || !business) {
        skip("no number or name");
        continue;
      }
      // A business registrant becomes the legal name; a person registrant makes this a sole
      // proprietorship, whose address is never stored and whose owner is never named.
      const registrant = row.get("registrant").split(/\s*;\s*/)[0] ?? "";
      const byBusiness = isBusiness(registrant);
      const filed = parseDate(row.get("filedAt"));
      const r = await upsertEntity(
        db,
        {
          source: "fbn",
          sourceId: number,
          name: titleCase(byBusiness ? registrant : business) ?? business,
          dba: byBusiness ? titleCase(business) : null,
          entityType: byBusiness ? entityTypeFromName(registrant) : "sole_prop",
          address1: titleCase(row.get("address")),
          city: titleCase(row.get("city")),
          zip: row.get("zip") || null,
          county: "San Diego",
          raw: { file_number: number, filed_at: filed },
        },
        now,
      );
      result.upserted++;
      if (filed && filed >= recentCutoff) {
        // Dated the day the upload is read, so it reaches the next Radar whenever Joe uploads; the filing date is in the note.
        await event(r.entityId, { eventType: "new_business", severity: "info", title: "New fictitious business name filed", summary: `Filed ${filed}. San Diego County file ${number}`, eventDate: today, key: `${number}:new` });
      }
    }
  }
  return result;
}
