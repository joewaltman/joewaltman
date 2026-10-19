import type { Severity } from "@jw/db";
import { titleCase } from "../normalize";

// The event types a Watchlist shows, with the label used for muting. New sources add theirs here.
export const WATCH_EVENTS: Record<string, { label: string; source: string }> = {
  bankruptcy_filing: { label: "Bankruptcy filings", source: "Federal courts (CourtListener)" },
  bankruptcy_adversary: { label: "Bankruptcy court lawsuits", source: "Federal courts (CourtListener)" },
  federal_civil_case: { label: "Federal civil cases", source: "Federal courts (CourtListener)" },
  tax_lien: { label: "Tax liens", source: "Liens and filings (uploaded)" },
  judgment_lien: { label: "Judgment liens", source: "Liens and filings (uploaded)" },
  notice_of_default: { label: "Notices of default", source: "Liens and filings (uploaded)" },
  mechanics_lien: { label: "Mechanic's liens", source: "Liens and filings (uploaded)" },
  ucc_filing: { label: "UCC financing statements", source: "Liens and filings (uploaded)" },
  lien_released: { label: "Lien releases", source: "Liens and filings (uploaded)" },
  ucc_terminated: { label: "UCC terminations", source: "Liens and filings (uploaded)" },
  dlse_judgment: { label: "Labor Commissioner judgments", source: "Labor Commissioner (uploaded)" },
  dlse_debarment: { label: "Public works debarments", source: "Labor Commissioner (uploaded)" },
  sos_status_change: { label: "Secretary of State status changes", source: "Secretary of State (uploaded)" },
  sos_statement_of_information: { label: "Statements of information", source: "Secretary of State (uploaded)" },
  cslb_status_change: { label: "Contractor license status changes", source: "CSLB" },
  cslb_bond_cancellation: { label: "Contractor bond cancellations", source: "CSLB" },
  cslb_workers_comp_change: { label: "Contractor workers' comp changes", source: "CSLB" },
  cslb_license_removed: { label: "Contractor licenses dropped from the state file", source: "CSLB" },
  dca_status_change: { label: "State license status changes", source: "California DCA" },
  dca_license_removed: { label: "State licenses dropped from the DCA file", source: "California DCA" },
  abc_status_change: { label: "Liquor license status changes", source: "California ABC" },
  npi_deactivated: { label: "Healthcare provider numbers (NPI) deactivated", source: "CMS NPI registry" },
  sba_loan: { label: "New SBA loans over $250,000", source: "SBA loan data" },
  account_cancelled: { label: "Business tax account cancellations", source: "City of San Diego" },
};

export const WATCH_EVENT_TYPES = Object.keys(WATCH_EVENTS);

export const SEVERITY_LABELS: Record<Severity, string> = {
  serious: "Serious",
  watch: "Worth a look",
  info: "For your records",
};

// ABC status codes whose meaning is plain. Others are shown as ABC writes them.
const ABC_STATUS: Record<string, string> = {
  ACTIVE: "active",
  PEND: "pending",
  SUSPEN: "suspended",
  REV: "revoked",
  SUREND: "surrendered",
  CANCEL: "cancelled",
};
const abcStatus = (code: unknown) => {
  const c = String(code ?? "").trim().toUpperCase();
  return ABC_STATUS[c] ?? (c ? `${c} (ABC's code)` : "unknown");
};
const lower = (v: unknown) => (titleCase(String(v ?? "unknown")) ?? "unknown").toLowerCase();

export interface WatchEventInput {
  eventType: string;
  title: string;
  summary: string | null;
  raw: Record<string, unknown>;
}

export interface NoteParts {
  // A short statement of what happened, without a closing period.
  headline: string;
  // Supporting detail (case number, license, escrow company), or null.
  detail: string | null;
}

const trimStop = (s: string | null | undefined) => (s ? s.trim().replace(/\.$/, "") : null) || null;

// What happened, split into a headline and a detail line, for the email table and the dashboard.
export function watchNoteParts(e: WatchEventInput): NoteParts {
  const raw = e.raw ?? {};
  switch (e.eventType) {
    case "abc_status_change": {
      const extra = [raw.transfer ? "The record lists a license transfer." : "", raw.escrow ? `Escrow with ${String(raw.escrow)}.` : ""].filter(Boolean).join(" ");
      return { headline: `Liquor license status changed from ${abcStatus(raw.statusFrom)} to ${abcStatus(raw.status)}`, detail: extra || null };
    }
    case "cslb_status_change": {
      const m = e.title.match(/status: (.+) to (.+)$/);
      return { headline: m ? `Contractor license status changed from ${lower(m[1])} to ${lower(m[2])}` : e.title, detail: trimStop(e.summary) };
    }
    case "cslb_workers_comp_change": {
      const m = e.title.match(/coverage: (.+) to (.+)$/);
      return { headline: m ? `Workers' comp on the contractor license changed from "${m[1]}" to "${m[2]}"` : e.title, detail: null };
    }
    case "cslb_bond_cancellation":
      return { headline: "A cancellation of the contractor's license bond is on file", detail: trimStop(e.summary) };
    case "cslb_license_removed":
      return { headline: "The contractor license no longer appears in the state's license file", detail: null };
    case "dca_status_change": {
      const m = e.title.match(/^(.+) license status: (.+) to (.+)$/);
      return { headline: m ? `State license (${m[1]}) status changed from ${lower(m[2])} to ${lower(m[3])}` : e.title, detail: trimStop(e.summary) };
    }
    case "dca_license_removed": {
      const m = e.title.match(/^(.+) license no longer in the DCA file$/);
      return { headline: `The state license${m ? ` (${m[1]})` : ""} no longer appears in the DCA license file`, detail: trimStop(e.summary) };
    }
    case "sos_status_change": {
      const m = e.title.match(/status: (.+) to (.+)$/);
      return { headline: m ? `Secretary of State status changed from ${m[1]} to ${m[2]}` : e.title, detail: trimStop(e.summary) };
    }
    case "account_cancelled":
      return { headline: "The City of San Diego business tax account was cancelled", detail: null };
    default:
      return { headline: trimStop(e.title) ?? e.title, detail: trimStop(e.summary) };
  }
}

// One plain-English line per event: the headline and detail as sentences.
export function watchNote(e: WatchEventInput): string {
  const { headline, detail } = watchNoteParts(e);
  return detail ? `${headline}. ${detail}${/[.!?]$/.test(detail) ? "" : "."}` : `${headline}.`;
}
