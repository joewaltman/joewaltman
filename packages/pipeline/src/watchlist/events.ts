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

// One plain-English line per event for the dashboard and the weekly email.
export function watchNote(e: WatchEventInput): string {
  const raw = e.raw ?? {};
  switch (e.eventType) {
    case "abc_status_change": {
      const line = `Liquor license status changed from ${abcStatus(raw.statusFrom)} to ${abcStatus(raw.status)}.`;
      const extra = [raw.transfer ? "The record lists a license transfer." : "", raw.escrow ? `Escrow with ${String(raw.escrow)}.` : ""];
      return [line, ...extra].filter(Boolean).join(" ");
    }
    case "cslb_status_change": {
      const m = e.title.match(/status: (.+) to (.+)$/);
      const line = m ? `Contractor license status changed from ${lower(m[1])} to ${lower(m[2])}.` : `${e.title}.`;
      return e.summary ? `${line} ${e.summary}.` : line;
    }
    case "cslb_workers_comp_change": {
      const m = e.title.match(/coverage: (.+) to (.+)$/);
      return m ? `Workers' comp on the contractor license changed from "${m[1]}" to "${m[2]}".` : `${e.title}.`;
    }
    case "cslb_bond_cancellation":
      return `A cancellation of the contractor's license bond is on file. ${e.summary ?? ""}`.trim();
    case "cslb_license_removed":
      return "The contractor license no longer appears in the state's license file.";
    case "dca_status_change": {
      const m = e.title.match(/^(.+) license status: (.+) to (.+)$/);
      const line = m ? `State license (${m[1]}) status changed from ${lower(m[2])} to ${lower(m[3])}.` : `${e.title}.`;
      return e.summary ? `${line} ${e.summary}.` : line;
    }
    case "dca_license_removed": {
      const m = e.title.match(/^(.+) license no longer in the DCA file$/);
      const line = `The state license${m ? ` (${m[1]})` : ""} no longer appears in the DCA license file.`;
      return e.summary ? `${line} ${e.summary}.` : line;
    }
    case "sos_status_change": {
      const m = e.title.match(/status: (.+) to (.+)$/);
      const line = m ? `Secretary of State status changed from ${m[1]} to ${m[2]}.` : `${e.title}.`;
      return e.summary ? `${line} ${e.summary}.` : line;
    }
    case "account_cancelled":
      return "The City of San Diego business tax account was cancelled.";
    default:
      return e.summary ? `${e.title}. ${e.summary}.` : `${e.title}.`;
  }
}
