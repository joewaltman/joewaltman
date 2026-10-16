import type { Severity } from "@jw/db";
import { titleCase } from "../normalize";

// The event types a Watchlist shows, with the label used for muting. New sources add theirs here.
export const WATCH_EVENTS: Record<string, { label: string; source: string }> = {
  bankruptcy_filing: { label: "Bankruptcy filings", source: "Federal courts (CourtListener)" },
  bankruptcy_adversary: { label: "Bankruptcy court lawsuits", source: "Federal courts (CourtListener)" },
  federal_civil_case: { label: "Federal civil cases", source: "Federal courts (CourtListener)" },
  cslb_status_change: { label: "Contractor license status changes", source: "CSLB" },
  cslb_bond_cancellation: { label: "Contractor bond cancellations", source: "CSLB" },
  cslb_workers_comp_change: { label: "Contractor workers' comp changes", source: "CSLB" },
  cslb_license_removed: { label: "Contractor licenses dropped from the state file", source: "CSLB" },
  abc_status_change: { label: "Liquor license status changes", source: "California ABC" },
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
    case "account_cancelled":
      return "The City of San Diego business tax account was cancelled.";
    default:
      return e.summary ? `${e.title}. ${e.summary}.` : `${e.title}.`;
  }
}
