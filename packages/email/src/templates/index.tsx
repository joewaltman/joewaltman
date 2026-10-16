import { Button, Link, Text } from "@react-email/components";
import type { ReactElement } from "react";
import { buttonStyle, linkStyle, textStyle } from "./layout";

export interface Template {
  name: string;
  subject: string;
  preview: string;
  body: ReactElement;
}

export function confirmSubscription(input: { toolName: string; confirmUrl: string }): Template {
  return {
    name: "confirm-subscription",
    subject: `Confirm your ${input.toolName} subscription`,
    preview: "One click to confirm, or ignore this email.",
    body: (
      <>
        <Text style={textStyle}>
          Someone, hopefully you, asked to get {input.toolName} emails from Joe Waltman at this
          address.
        </Text>
        <Text style={textStyle}>
          <Button href={input.confirmUrl} style={buttonStyle}>
            Confirm your subscription
          </Button>
        </Text>
        <Text style={textStyle}>
          If you did not ask for this, ignore this email and you will not hear from me again.
        </Text>
      </>
    ),
  };
}

export function magicLink(input: { url: string }): Template {
  return {
    name: "magic-link",
    subject: "Your sign-in link for joewaltman.com",
    preview: "This link works once and expires in 15 minutes.",
    body: (
      <>
        <Text style={textStyle}>
          <Button href={input.url} style={buttonStyle}>
            Sign in to joewaltman.com
          </Button>
        </Text>
        <Text style={textStyle}>
          This link works once and expires in 15 minutes. If you did not ask for it, ignore this
          email.
        </Text>
      </>
    ),
  };
}

export interface TariffResultEmailInput {
  pathTitle: string;
  summary: string[];
  sections: Array<{ title: string; items: string[] }>;
  resultUrl: string;
  brokerSummary: string;
  asOf: string;
}

export function tariffResult(input: TariffResultEmailInput): Template {
  return {
    name: "tariff-result",
    subject: `Your tariff refund path: ${input.pathTitle}`,
    preview: input.summary[0] ?? input.pathTitle,
    body: (
      <>
        <Text style={{ ...textStyle, fontSize: "20px", fontWeight: 600 }}>{input.pathTitle}</Text>
        {input.summary.map((s) => (
          <Text key={s} style={textStyle}>
            {s}
          </Text>
        ))}
        {input.sections.map((section) => (
          <div key={section.title}>
            <Text style={{ ...textStyle, fontWeight: 600, margin: "18px 0 6px" }}>{section.title}</Text>
            {section.items.map((item) => (
              <Text key={item} style={{ ...textStyle, margin: "0 0 6px" }}>
                {"•"} {item}
              </Text>
            ))}
          </div>
        ))}
        <Text style={{ ...textStyle, marginTop: "18px" }}>
          <Link href={input.resultUrl} style={linkStyle}>
            See your result with sources
          </Link>
        </Text>
        <Text style={{ ...textStyle, fontWeight: 600, margin: "24px 0 6px" }}>
          Send this to your broker
        </Text>
        <Text
          style={{
            ...textStyle,
            whiteSpace: "pre-wrap",
            fontSize: "14px",
            background: "#f3f5f7",
            padding: "12px",
          }}
        >
          {input.brokerSummary}
        </Text>
        <Text style={{ ...textStyle, color: "#555555", fontSize: "13px" }}>
          This is general information, not legal or customs advice. Rules as of {input.asOf}.
        </Text>
      </>
    ),
  };
}

export function brokerReviewRequest(input: {
  brokerName: string;
  importerEmail: string;
  brokerSummary: string;
}): Template {
  return {
    name: "broker-review-request",
    subject: `Tariff refund review request from ${input.importerEmail}`,
    preview: `${input.importerEmail} asked for a review of their IEEPA refund path.`,
    body: (
      <>
        <Text style={textStyle}>Hi {input.brokerName},</Text>
        <Text style={textStyle}>
          {input.importerEmail} used the Tariff Refund Tool on joewaltman.com and asked for this
          summary to be sent to you for review. Reply to them directly at {input.importerEmail}.
        </Text>
        <Text style={{ ...textStyle, whiteSpace: "pre-wrap", fontSize: "14px", background: "#f3f5f7", padding: "12px" }}>
          {input.brokerSummary}
        </Text>
      </>
    ),
  };
}

export interface RadarDigestInput {
  areas: string;
  weekLabel: string;
  sections: Array<{ title: string; items: string[]; more: number }>;
  csvUrl: string;
  wantThisUrl: string;
}

export function radarDigest(input: RadarDigestInput): Template {
  const counts = input.sections.map((s) => s.items.length + s.more);
  const total = counts.reduce((a, b) => a + b, 0);
  const newBusinesses = input.sections.find((s) => s.title.startsWith("New businesses"));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const newCount = newBusinesses ? newBusinesses.items.length + newBusinesses.more : 0;
  const headline =
    newCount > 0 ? plural(newCount, "new business", "new businesses") : plural(total, "new listing", "new listings");
  if (total === 0) {
    return {
      name: "radar-digest",
      subject: `New Business Radar: a quiet week in ${input.areas}`,
      preview: `Nothing new in ${input.areas} for ${input.weekLabel}.`,
      body: (
        <>
          <Text style={textStyle}>
            A quiet week: no new businesses or license activity in {input.areas} for {input.weekLabel}.
          </Text>
          <Text style={textStyle}>Reply if you want a wider area or more categories.</Text>
        </>
      ),
    };
  }
  return {
    name: "radar-digest",
    subject: `New Business Radar: ${headline} in ${input.areas}, ${input.weekLabel}`,
    preview: `${headline} in ${input.areas}.`,
    body: (
      <>
        <Text style={textStyle}>
          {input.weekLabel}, {input.areas}.
        </Text>
        {input.sections
          .filter((s) => s.items.length > 0)
          .map((section) => (
            <div key={section.title}>
              <Text style={{ ...textStyle, fontWeight: 600, margin: "20px 0 6px" }}>
                {section.title} ({section.items.length + section.more})
              </Text>
              {section.items.map((item) => (
                <Text key={item} style={{ ...textStyle, margin: "0 0 8px" }}>
                  {"•"} {item}
                </Text>
              ))}
              {section.more > 0 ? (
                <Text style={{ ...textStyle, color: "#555555" }}>And {section.more} more in the CSV.</Text>
              ) : null}
            </div>
          ))}
        <Text style={{ ...textStyle, marginTop: "20px" }}>
          <Link href={input.csvUrl} style={linkStyle}>
            Download this week as a CSV
          </Link>
        </Text>
        <Text style={textStyle}>Reply with a name you want more on.</Text>
        <Text style={textStyle}>
          Want this piped into your CRM with enrichment and follow-up sequences? Reply or{" "}
          <Link href={input.wantThisUrl} style={linkStyle}>
            click here
          </Link>
          .
        </Text>
      </>
    ),
  };
}

export interface WatchlistDigestInput {
  weekLabel: string;
  totalCustomers: number;
  customers: Array<{ name: string; events: Array<{ severity: string; date: string; note: string; sourceUrl: string | null }> }>;
  needsReview: number;
  dashboardUrl: string;
  wantThisUrl: string;
}

export function watchlistDigest(input: WatchlistDigestInput): Template {
  const withNews = input.customers.filter((c) => c.events.length > 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const review =
    input.needsReview > 0 ? (
      <Text style={textStyle}>
        {plural(input.needsReview, "customer needs", "customers need")} you to pick the right match before they
        can be watched.{" "}
        <Link href={input.dashboardUrl} style={linkStyle}>
          Pick matches
        </Link>
      </Text>
    ) : null;
  if (withNews.length === 0) {
    return {
      name: "watchlist-digest",
      subject: "Customer Watchlist: nothing new this week",
      preview: `No new public records on your ${plural(input.totalCustomers, "customer", "customers")}.`,
      body: (
        <>
          <Text style={textStyle}>
            Nothing new in the public records on your {plural(input.totalCustomers, "customer", "customers")} for{" "}
            {input.weekLabel}.
          </Text>
          <Text style={textStyle}>
            <Link href={input.dashboardUrl} style={linkStyle}>
              See your list
            </Link>
          </Text>
          {review}
        </>
      ),
    };
  }
  return {
    name: "watchlist-digest",
    subject: `Customer Watchlist: new public records on ${plural(withNews.length, "customer", "customers")}, ${input.weekLabel}`,
    preview: withNews.map((c) => c.name).join(", "),
    body: (
      <>
        <Text style={textStyle}>
          New public records on {withNews.length} of your {plural(input.totalCustomers, "customer", "customers")},{" "}
          {input.weekLabel}. Each line links to the record it came from.
        </Text>
        {withNews.map((c) => (
          <div key={c.name}>
            <Text style={{ ...textStyle, fontWeight: 600, margin: "20px 0 6px" }}>{c.name}</Text>
            {c.events.map((e) => (
              <Text key={`${e.date}${e.note}`} style={{ ...textStyle, margin: "0 0 8px" }}>
                {"•"} {e.severity}, {e.date}: {e.note}{" "}
                {e.sourceUrl ? (
                  <Link href={e.sourceUrl} style={linkStyle}>
                    Source
                  </Link>
                ) : null}
              </Text>
            ))}
          </div>
        ))}
        <Text style={{ ...textStyle, marginTop: "20px" }}>
          <Link href={input.dashboardUrl} style={linkStyle}>
            See your list, or mute a kind of event
          </Link>
        </Text>
        {review}
        <Text style={textStyle}>
          Want credit holds and collections sequences wired into your ERP or QuickBooks? Reply or{" "}
          <Link href={input.wantThisUrl} style={linkStyle}>
            click here
          </Link>
          .
        </Text>
      </>
    ),
  };
}

export function jobFailed(input: {
  job: string;
  error: string;
  startedAt: string;
  attempt: number;
  adminUrl: string;
}): Template {
  return {
    name: "job-failed",
    subject: `Ingestion job failed: ${input.job}`,
    preview: input.error.slice(0, 120),
    body: (
      <>
        <Text style={textStyle}>
          The {input.job} job failed at {input.startedAt} (attempt {input.attempt} today).
        </Text>
        <Text style={{ ...textStyle, fontFamily: "Menlo, monospace", fontSize: "13px", whiteSpace: "pre-wrap" }}>
          {input.error}
        </Text>
        <Text style={textStyle}>
          The scheduler tries once more later today. If the source changed its format, see
          docs/runbooks/pipeline.md.
        </Text>
        <Text style={textStyle}>
          <Link href={input.adminUrl} style={linkStyle}>
            Open job runs
          </Link>
        </Text>
      </>
    ),
  };
}

export function handRaiseNotice(input: {
  tool: string;
  email: string | null;
  context: Record<string, unknown>;
  adminUrl: string;
}): Template {
  const who = input.email ?? "an anonymous visitor";
  return {
    name: "hand-raise-notice",
    subject: `Hand-raise on ${input.tool} from ${who}`,
    preview: `${who} clicked the hand-raise on ${input.tool}.`,
    body: (
      <>
        <Text style={textStyle}>
          {who} clicked the hand-raise on {input.tool}.
        </Text>
        <Text style={{ ...textStyle, fontFamily: "Menlo, monospace", fontSize: "13px", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(input.context, null, 2)}
        </Text>
        <Text style={textStyle}>
          <Link href={input.adminUrl} style={linkStyle}>
            Open the hand-raises inbox
          </Link>
        </Text>
      </>
    ),
  };
}
