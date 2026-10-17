import { countyForZip } from "@jw/content";
import { and, desc, eq, jobRuns } from "@jw/db";
import { parse } from "csv-parse/sync";
import { archiveKey } from "../archive";
import { entityTypeFromName, looksLikePerson, normalizeName, titleCase, zip5 } from "../normalize";
import { addEvent, upsertEntity } from "../resolve";
import { type Job, download } from "../runner";
import { pacificDay } from "../schedule";

// SBA 7(a) and 504 loan data (FOIA), published quarterly about three weeks after each quarter ends.
// Each file holds every loan since the start of its range, so a loan is news when it first appears:
// approved after the previous file's as-of date. The first run only records that date.
export const SBA_DATASET_PAGE = "https://data.sba.gov/dataset/7a-504-foia";
export const MIN_AMOUNT = 250_000;
const PROGRAMS = { "7a": "SBA 7(a)", "504": "SBA 504" } as const;
type Program = keyof typeof PROGRAMS;

export interface SbaFile {
  program: Program;
  url: string;
  name: string;
  asOf: string;
}

// The current-range file for each program ("FOIA_7a_FY2020_Present_asof_260630.csv").
export function sbaFiles(html: string): SbaFile[] {
  const out = new Map<Program, SbaFile>();
  for (const m of html.matchAll(/href="([^"]*FOIA_(7a|504)_FY\d{4}_Present_asof_(\d{6})\.csv)"/gi)) {
    const program = m[2]!.toLowerCase() as Program;
    const d = m[3]!;
    const file = { program, url: new URL(m[1]!, SBA_DATASET_PAGE).toString(), name: m[1]!.split("/").pop()!, asOf: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` };
    const prev = out.get(program);
    if (!prev || prev.asOf < file.asOf) out.set(program, file);
  }
  return [...out.values()];
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// The spec asks for an amount band rather than the exact figure.
export function amountBand(amount: number): string {
  if (amount >= 5_000_000) return "$5 million or more";
  if (amount >= 2_000_000) return "$2 million to $5 million";
  if (amount >= 1_000_000) return "$1 million to $2 million";
  if (amount >= 500_000) return "$500,000 to $1 million";
  return "$250,000 to $500,000";
}

const AGE_NOTES: Array<[RegExp, string]> = [
  [/^startup/i, "A startup: the loan opens the business."],
  [/^new business/i, "A business two years old or less."],
  [/^change of ownership/i, "Financing a change of ownership."],
];

export interface SbaLoan {
  program: Program;
  borrower: string;
  street: string | null;
  city: string | null;
  zip: string | null;
  lender: string | null;
  amount: number;
  approved: string;
  naics: string | null;
  businessAge: string | null;
  status: string | null;
}

type Row = Record<string, string>;

// San Diego County business loans over the minimum, approved after a date. Individual borrowers
// and cancelled loans are left out.
export function parseSba(body: Uint8Array, program: Program, after: string): SbaLoan[] {
  const out: SbaLoan[] = [];
  let checked = false;
  parse(Buffer.from(new TextDecoder("windows-1252").decode(body)), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    on_record: (r: Row) => {
      if (!checked) {
        for (const col of ["BorrName", "BorrZip", "GrossApproval", "ApprovalDate", "ProjectCounty", "ProjectState", "BusinessType", "LoanStatus"]) {
          if (!(col in r)) throw new Error(`SBA ${program} file has no ${col} column; the format changed`);
        }
        checked = true;
      }
      const approved = (r.ApprovalDate ?? "").slice(0, 10);
      if (!(approved > after)) return null;
      const zip = zip5(r.BorrZip);
      const inCounty = r.ProjectState === "CA" && ((r.ProjectCounty ?? "").toUpperCase() === "SAN DIEGO" || (zip !== null && countyForZip(zip) === "San Diego"));
      const amount = Number(r.GrossApproval);
      if (!inCounty || !(amount > MIN_AMOUNT)) return null;
      if ((r.BusinessType ?? "").toUpperCase() === "INDIVIDUAL" || (r.LoanStatus ?? "").toUpperCase() === "CANCLD") return null;
      const borrower = decode(r.BorrName ?? "");
      if (!borrower || looksLikePerson(borrower)) return null;
      const lender = program === "7a" ? r.BankName : [r.CDC_Name, r.ThirdPartyLender_Name].filter(Boolean).join(" with ");
      out.push({
        program,
        borrower,
        street: decode(r.BorrStreet ?? "") || null,
        city: decode(r.BorrCity ?? "") || null,
        zip,
        lender: lender ? decode(lender).replace(/\s+/g, " ") : null,
        amount,
        approved,
        naics: (r.NaicsCode ?? "").trim() || null,
        businessAge: (r.BusinessAge ?? "").trim() || null,
        status: (r.LoanStatus ?? "").trim() || null,
      });
      return null;
    },
  });
  return out;
}

export function sbaJob(): Job {
  return {
    name: "sba",
    async run(ctx) {
      const today = pacificDay(ctx.now);
      const [last] = await ctx.db
        .select({ meta: jobRuns.meta })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, "sba"), eq(jobRuns.status, "success")))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      const asOf: Record<string, string> = { ...((last?.meta?.asOf as Record<string, string> | undefined) ?? {}) };
      const page = new TextDecoder().decode((await download(ctx, SBA_DATASET_PAGE, "dataset.html")).body);
      const files = sbaFiles(page);
      for (const p of Object.keys(PROGRAMS)) {
        if (!files.some((f) => f.program === p)) throw new Error(`SBA dataset page lists no current ${p} file; the page changed`);
      }

      let rowsIn = 0;
      let rowsUpserted = 0;
      let events = 0;
      const archived: string[] = [];
      const baseline: string[] = [];
      for (const f of files) {
        const previous = asOf[f.program];
        if (previous === f.asOf) continue;
        if (!previous) {
          // First sight of this program: remember the date; the next quarter's file brings the news.
          asOf[f.program] = f.asOf;
          baseline.push(f.program);
          continue;
        }
        const body = (await download(ctx, f.url, f.name, undefined, 900_000)).body;
        const loans = parseSba(body, f.program, previous);
        rowsIn += loans.length;
        archived.push(await ctx.archive.put(archiveKey("sba", today, `${f.name}.json`), new TextEncoder().encode(JSON.stringify(loans))));
        for (const loan of loans) {
          const key = `${loan.program}:${loan.approved}:${normalizeName(loan.borrower)}:${loan.amount}`;
          const band = amountBand(loan.amount);
          const { entityId } = await upsertEntity(
            ctx.db,
            {
              source: "sba",
              sourceId: key,
              name: titleCase(loan.borrower) ?? loan.borrower,
              entityType: entityTypeFromName(loan.borrower),
              address1: titleCase(loan.street),
              city: titleCase(loan.city),
              zip: loan.zip,
              naics: loan.naics,
              raw: { program: loan.program, approved: loan.approved, amount_band: band, lender: loan.lender, business_age: loan.businessAge, status: loan.status },
            },
            ctx.now,
          );
          rowsUpserted++;
          const age = AGE_NOTES.find(([re]) => re.test(loan.businessAge ?? ""))?.[1];
          if (
            await addEvent(ctx.db, {
              entityId,
              source: "sba",
              eventType: "sba_loan",
              // Dated the day the loan first appears, so it lands in that week's Radar; the approval date is in the note.
              eventDate: today,
              severity: "info",
              title: `${PROGRAMS[loan.program]} loan approved`,
              summary: [`Approved ${loan.approved}`, `${band}${loan.lender ? ` from ${loan.lender}` : ""}`, age?.replace(/\.$/, "")].filter(Boolean).join(". "),
              sourceUrl: SBA_DATASET_PAGE,
              raw: { program: loan.program, amountBand: band, lender: loan.lender, approved: loan.approved },
              dedupeKey: `sba:${key}`,
            })
          )
            events++;
        }
        asOf[f.program] = f.asOf;
        ctx.log(`sba: ${f.name}: ${loans.length} new San Diego loans over $250,000 since ${previous}`);
      }
      return { rowsIn, rowsUpserted, events, meta: { asOf, baseline, archived } };
    },
  };
}
