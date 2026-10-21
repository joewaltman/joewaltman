/** @jsxRuntime automatic @jsxImportSource react */
// The pipeline runs this package through tsx, which only applies a tsconfig to files inside that
// config's include, so the JSX transform is pinned here rather than left to the caller's config.
import { Button, Link, Text } from "@react-email/components";
import type { ReactElement } from "react";
import { buttonStyle, linkStyle, textStyle } from "./layout";
import { Callout, ColorTable, CtaButton, Heading, Lines, Steps, Summary, type Tone, muted } from "./parts";

export interface Template {
  name: string;
  subject: string;
  preview: string;
  body: ReactElement;
  // The plain-text part, for templates built on tables, which do not convert well on their own.
  text?: string;
}

// Plain-text lines: null skips a line, "" is a blank line, and runs of blank lines collapse to one.
const bullets = (lines: Array<string | null>) =>
  lines
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
  kind: "refund" | "next-step" | "no-path";
  summary: string[];
  deadlines: string[];
  // Next steps, any extra actions, and documents to gather.
  sections: Array<{ title: string; items: string[] }>;
  assumptions: string[];
  updatesUrl?: string | null;
  resultUrl: string;
  brokerSummary: string;
  asOf: string;
}

const PATH_TONE: Record<TariffResultEmailInput["kind"], Tone> = { refund: "green", "next-step": "amber", "no-path": "gray" };

export function tariffResult(input: TariffResultEmailInput): Template {
  const numbered = (items: string[]) => items.map((x, i) => `${i + 1}. ${x}`);
  const text = bullets([
    input.pathTitle.toUpperCase(),
    ...input.summary,
    ...(input.deadlines.length > 0 ? ["", "DEADLINES", ...numbered(input.deadlines)] : []),
    ...input.sections.flatMap((s) => ["", s.title.toUpperCase(), ...numbered(s.items)]),
    "",
    `See your result with sources: ${input.resultUrl}`,
    "",
    "SEND THIS TO YOUR BROKER",
    input.brokerSummary,
    input.updatesUrl ? `\nConfirm you want an email when refund rules or deadlines change: ${input.updatesUrl}` : null,
    ...(input.assumptions.length > 0 ? ["", "Assumptions", ...input.assumptions] : []),
    "",
    `This is general information, not legal or customs advice. Rules as of ${input.asOf}.`,
  ]);
  return {
    name: "tariff-result",
    text,
    subject: `Your tariff refund path: ${input.pathTitle}`,
    preview: input.summary[0] ?? input.pathTitle,
    body: (
      <>
        <Callout tone={PATH_TONE[input.kind]}>
          <span style={{ fontSize: "18px", fontWeight: 700 }}>{input.pathTitle}</span>
          {input.summary.map((s) => (
            <span key={s}>
              <br />
              <br />
              {s}
            </span>
          ))}
        </Callout>
        {input.deadlines.length > 0 ? (
          <>
            <Heading tone="red">Deadlines</Heading>
            <Steps items={input.deadlines} tone="red" />
          </>
        ) : null}
        {input.sections.map((section) => (
          <div key={section.title}>
            <Heading tone="blue">{section.title}</Heading>
            <Steps items={section.items} tone="blue" />
          </div>
        ))}
        <CtaButton href={input.resultUrl}>See your result with sources</CtaButton>
        <Heading>Send this to your broker</Heading>
        <Text style={{ ...textStyle, whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: "1.5", background: "#f2f4f7", padding: "12px", borderRadius: "4px" }}>
          {input.brokerSummary}
        </Text>
        {input.updatesUrl ? (
          <Text style={{ ...textStyle, fontSize: "14px" }}>
            <Link href={input.updatesUrl} style={linkStyle}>
              Confirm you want an email when refund rules or deadlines change
            </Link>
          </Text>
        ) : null}
        {input.assumptions.length > 0 ? (
          <>
            <Text style={{ ...muted, fontWeight: 600, margin: "18px 0 4px" }}>Assumptions</Text>
            {input.assumptions.map((a) => (
              <Text key={a} style={{ ...muted, margin: "0 0 4px" }}>
                {a}
              </Text>
            ))}
          </>
        ) : null}
        <Text style={{ ...muted, marginTop: "14px" }}>This is general information, not legal or customs advice. Rules as of {input.asOf}.</Text>
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
  sections: Array<{
    id: string;
    title: string;
    rows: Array<{ key: string; name: string; sub: string | null; what: string; place: string; date: string; website: string | null }>;
    more: number;
  }>;
  csvUrl: string;
  wantThisUrl: string;
}

const SECTION_TONE: Record<string, Tone> = { new: "green", liquor: "purple", capital: "blue", licenses: "amber" };

export function radarDigest(input: RadarDigestInput): Template {
  const counts = input.sections.map((s) => ({ ...s, total: s.rows.length + s.more }));
  const total = counts.reduce((a, s) => a + s.total, 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const newCount = counts.find((s) => s.id === "new")?.total ?? 0;
  const headline = newCount > 0 ? plural(newCount, "new business", "new businesses") : plural(total, "new listing", "new listings");
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
  const shortTitle: Record<string, [string, string]> = {
    new: ["new business", "new businesses"],
    liquor: ["liquor license change", "liquor license changes"],
    capital: ["SBA loan", "SBA loans"],
    licenses: ["contractor license", "contractor licenses"],
  };
  const summaryText = counts
    .filter((s) => s.total > 0)
    .map((s) => plural(s.total, ...(shortTitle[s.id] ?? [s.title, s.title])))
    .join(", ");
  const text = bullets([
    `${input.areas}, ${input.weekLabel}.`,
    `${summaryText}.`,
    ...counts
      .filter((s) => s.rows.length > 0)
      .flatMap((s) => [
        "",
        s.title.toUpperCase(),
        ...s.rows.map((r) => `- ${r.name} (${r.what}), ${r.place}, ${r.date}.${r.sub ? ` ${r.sub.replace(/\.?$/, ".")}` : ""}${r.website ? ` ${r.website}` : ""}`),
        s.more > 0 ? `And ${s.more} more in the CSV.` : null,
      ]),
    "",
    `Download this week as a CSV: ${input.csvUrl}`,
    "Reply with a name you want more on.",
    `Want this piped into your CRM with enrichment and follow-up sequences? Reply or click here: ${input.wantThisUrl}`,
  ]);
  return {
    name: "radar-digest",
    text,
    subject: `New Business Radar: ${headline} in ${input.areas}, ${input.weekLabel}`,
    preview: `${headline} in ${input.areas}.`,
    body: (
      <>
        <Text style={{ ...textStyle, marginBottom: "10px" }}>
          {input.areas}, {input.weekLabel}.
        </Text>
        <Summary
          items={counts
            .filter((s) => s.total > 0)
            .map((s) => ({ tone: SECTION_TONE[s.id] ?? "gray", text: plural(s.total, ...(shortTitle[s.id] ?? [s.title, s.title])) }))}
        />
        {counts
          .filter((s) => s.rows.length > 0)
          .map((s) => (
            <div key={s.id}>
              <Heading tone={SECTION_TONE[s.id] ?? "gray"}>{s.title}</Heading>
              <ColorTable
                columns={["Business", "What", "Where", "Date"]}
                widths={[undefined, "24%", "20%", "56px"]}
                rows={s.rows.map((r) => ({
                  key: r.key,
                  tone: SECTION_TONE[s.id] ?? "gray",
                  cells: [<Lines key="b" main={r.name} sub={r.sub} href={r.website} />, r.what, <span key="p" style={muted}>{r.place}</span>, <span key="d" style={muted}>{r.date}</span>],
                }))}
              />
              {s.more > 0 ? <Text style={{ ...muted, margin: "4px 0 0" }}>And {s.more} more in the CSV.</Text> : null}
            </div>
          ))}
        <CtaButton href={input.csvUrl}>Download this week as a CSV</CtaButton>
        <Text style={textStyle}>Reply with a name you want more on.</Text>
        <Text style={{ ...textStyle, fontSize: "14px" }}>
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

export interface WatchlistRow {
  customer: string;
  severity: "serious" | "watch" | "info";
  date: string;
  headline: string;
  detail: string | null;
  sourceUrl: string | null;
  // More than one record of the same kind, folded into this row.
  count: number;
}

export interface WatchlistDigestInput {
  weekLabel: string;
  totalCustomers: number;
  // Already grouped by customer, worst first.
  rows: WatchlistRow[];
  needsReview: number;
  dashboardUrl: string;
  wantThisUrl: string;
}

const SEVERITY_TONE: Record<WatchlistRow["severity"], Tone> = { serious: "red", watch: "amber", info: "green" };
const SEVERITY_WORDS: Record<WatchlistRow["severity"], [string, string]> = {
  serious: ["serious", "serious"],
  watch: ["worth a look", "worth a look"],
  info: ["for your records", "for your records"],
};
const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

export function watchlistDigest(input: WatchlistDigestInput): Template {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const customersWithNews = new Set(input.rows.map((r) => r.customer)).size;
  const review =
    input.needsReview > 0 ? (
      <Callout tone="blue">
        {plural(input.needsReview, "customer needs", "customers need")} you to pick the right match before they can be watched.{" "}
        <Link href={input.dashboardUrl} style={linkStyle}>
          Pick matches
        </Link>
      </Callout>
    ) : null;
  const reviewText = input.needsReview > 0 ? `${plural(input.needsReview, "customer needs", "customers need")} you to pick the right match before they can be watched: ${input.dashboardUrl}` : null;
  if (input.rows.length === 0) {
    return {
      name: "watchlist-digest",
      subject: "Customer Watchlist: nothing new this week",
      preview: `No new public records on your ${plural(input.totalCustomers, "customer", "customers")}.`,
      text: bullets([`Nothing new in the public records on your ${plural(input.totalCustomers, "customer", "customers")} for ${input.weekLabel}.`, reviewText, `See your list: ${input.dashboardUrl}`]),
      body: (
        <>
          <Text style={textStyle}>
            Nothing new in the public records on your {plural(input.totalCustomers, "customer", "customers")} for {input.weekLabel}.
          </Text>
          {review}
          <CtaButton href={input.dashboardUrl}>See your list</CtaButton>
        </>
      ),
    };
  }
  const count = (sev: WatchlistRow["severity"]) => input.rows.filter((r) => r.severity === sev).reduce((n, r) => n + r.count, 0);
  const pills = (["serious", "watch", "info"] as const)
    .map((sev) => ({ sev, n: count(sev) }))
    .filter((x) => x.n > 0)
    .map((x) => ({ tone: SEVERITY_TONE[x.sev], text: `${x.n} ${SEVERITY_WORDS[x.sev][x.n === 1 ? 0 : 1]}` }));
  const serious = count("serious");
  const textRows: string[] = [];
  input.rows.forEach((r, i) => {
    if (i === 0 || input.rows[i - 1]!.customer !== r.customer) textRows.push("", r.customer.toUpperCase());
    textRows.push(`- [${SEVERITY_WORDS[r.severity][0].replace(/^./, (c) => c.toUpperCase())}] ${shortDate(r.date)}: ${r.headline}.${r.detail ? ` ${r.detail.replace(/\.?$/, ".")}` : ""}`);
    if (r.sourceUrl) textRows.push(`  ${r.count > 1 ? "Latest record" : "Record"}: ${r.sourceUrl}`);
  });
  const text = bullets([
    `New public records on ${customersWithNews} of your ${plural(input.totalCustomers, "customer", "customers")}, ${input.weekLabel}.`,
    `${pills.map((p) => p.text).join(", ")}.`,
    ...textRows,
    "",
    reviewText,
    `See your list: ${input.dashboardUrl}`,
    `Want credit holds and collections sequences wired into your ERP or QuickBooks? Reply or click here: ${input.wantThisUrl}`,
  ]);
  return {
    name: "watchlist-digest",
    text,
    subject: `Customer Watchlist: ${serious > 0 ? `${plural(serious, "serious item", "serious items")}, ` : ""}new records on ${plural(customersWithNews, "customer", "customers")}, ${input.weekLabel}`,
    preview: [...new Set(input.rows.map((r) => r.customer))].join(", "),
    body: (
      <>
        <Text style={{ ...textStyle, marginBottom: "10px" }}>
          New public records on {customersWithNews} of your {plural(input.totalCustomers, "customer", "customers")}, {input.weekLabel}.
        </Text>
        <Summary items={pills} />
        <ColorTable
          columns={["Customer", "What happened", "Date"]}
          widths={["28%", undefined, "64px"]}
          rows={input.rows.map((r, i) => ({
            key: `${r.customer}-${i}`,
            tone: SEVERITY_TONE[r.severity],
            cells: [
              i === 0 || input.rows[i - 1]!.customer !== r.customer ? <span style={{ fontWeight: 700 }}>{r.customer}</span> : "",
              <>
                <Lines main={r.headline} sub={r.detail} />
                {r.sourceUrl ? (
                  <>
                    <br />
                    <Link href={r.sourceUrl} style={{ color: "#1f4a6b", fontSize: "13px" }}>
                      {r.count > 1 ? "Latest record" : "View record"}
                    </Link>
                  </>
                ) : null}
              </>,
              <span style={muted}>{shortDate(r.date)}</span>,
            ],
          }))}
        />
        <Text style={{ ...muted, margin: "4px 0 0" }}>Red is serious, amber is worth a look, green is for your records.</Text>
        {review}
        <CtaButton href={input.dashboardUrl}>See your list</CtaButton>
        <Text style={{ ...textStyle, fontSize: "14px" }}>
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

export interface AiworkResultInput {
  // "Reviewed by ... as of ..." or the caveat.
  standing: string;
  groups: Array<{
    heading: string;
    tone: Tone;
    items: Array<{ title: string; summary: string | null; check: string | null; todo: string[] }>;
  }>;
  notTriggered: string[];
  // Notes on the hiring systems picked: what built-in features to check.
  vendors?: { intro: string[]; answeredNo: string | null; systems: Array<{ name: string; lines: string[] }> } | null;
  // Numbered judgment calls behind the result: "[1] ...".
  assumptions?: string[];
  resultUrl: string;
  // Set when the visitor asked for rule-change emails: the double opt-in link.
  updatesUrl?: string | null;
  asOf: string;
}

export function aiworkResult(input: AiworkResultInput): Template {
  const count = input.groups.reduce((n, g) => n + g.items.length, 0);
  const TODO_SHOWN = 3;
  const text = bullets([
    input.standing,
    count === 0 ? "\nNothing in your answers triggers these rules today. Check again if you add AI screening, scheduling or monitoring tools." : null,
    ...input.groups.flatMap((g) => [
      "",
      g.heading.toUpperCase(),
      ...g.items.flatMap((item) => [
        `- ${item.title}`,
        item.check ? `  Check first: ${item.check}` : null,
        item.summary ? `  ${item.summary}` : null,
        ...item.todo.map((t) => `  To do: ${t}`),
      ]),
    ]),
    ...(input.vendors
      ? [
          "",
          "CHECK YOUR HIRING SOFTWARE",
          input.vendors.answeredNo,
          ...input.vendors.intro,
          ...input.vendors.systems.flatMap((v) => [`- ${v.name}`, ...v.lines.map((l) => `  ${l}`)]),
        ]
      : []),
    "",
    `See your checklist, sources and templates: ${input.resultUrl}`,
    input.notTriggered.length > 0 ? `Also checked, and not triggered by your answers: ${input.notTriggered.join("; ")}.` : null,
    input.updatesUrl ? `Confirm you want an email when these rules or dates change: ${input.updatesUrl}` : null,
    ...(input.assumptions && input.assumptions.length > 0 ? ["", "Assumptions", ...input.assumptions] : []),
    "",
    `Rules as of ${input.asOf}.`,
  ]);
  return {
    name: "aiwork-result",
    text,
    subject: count > 0 ? `Your California AI-at-Work checklist: ${count} ${count === 1 ? "item" : "items"}` : "Your California AI-at-Work checklist: nothing to do now",
    preview: input.groups[0]?.heading ?? "Nothing in your answers triggers these rules today.",
    body: (
      <>
        <Text style={{ ...muted, margin: "0 0 14px" }}>{input.standing}</Text>
        {count === 0 ? (
          <Text style={textStyle}>Nothing in your answers triggers these rules today. Check again if you add AI screening, scheduling or monitoring tools.</Text>
        ) : (
          <Summary
            items={input.groups.map((g) => {
              const label = g.heading.replace(/ \(since .*\)$/, "");
              return { tone: g.tone, text: `${g.items.length} ${label.charAt(0).toLowerCase()}${label.slice(1)}` };
            })}
          />
        )}
        {input.groups.map((g) => (
          <div key={g.heading}>
            <Heading tone={g.tone}>{g.heading}</Heading>
            <ColorTable
              columns={["What the rule asks", "To do"]}
              widths={["48%", undefined]}
              rows={g.items.map((item) => ({
                key: item.title,
                tone: g.tone,
                cells: [
                  <Lines key="w" main={item.title} sub={[item.check ? `Check first: ${item.check}` : null, item.summary].filter(Boolean).join(" ") || null} />,
                  <span key="t">
                    {item.todo.slice(0, TODO_SHOWN).map((t, i) => (
                      <span key={t}>
                        {i > 0 ? <br /> : null}
                        {"•"} {t}
                      </span>
                    ))}
                    {item.todo.length > TODO_SHOWN ? (
                      <>
                        <br />
                        <span style={muted}>And {item.todo.length - TODO_SHOWN} more on your checklist.</span>
                      </>
                    ) : null}
                  </span>,
                ],
              }))}
            />
          </div>
        ))}
        {input.vendors ? (
          <div>
            <Heading tone="blue">Check your hiring software</Heading>
            {input.vendors.answeredNo ? <Callout tone="amber">{input.vendors.answeredNo}</Callout> : null}
            {input.vendors.intro.map((line) => (
              <Text key={line} style={{ ...muted, margin: "0 0 8px" }}>
                {line}
              </Text>
            ))}
            <ColorTable
              columns={["System", "What to check"]}
              widths={["30%", undefined]}
              rows={input.vendors.systems.map((v) => ({
                key: v.name,
                tone: "blue" as const,
                cells: [
                  <Lines key="n" main={v.name} />,
                  <span key="l">
                    {v.lines.map((l, i) => (
                      <span key={l}>
                        {i > 0 ? <br /> : null}
                        {"•"} {l}
                      </span>
                    ))}
                  </span>,
                ],
              }))}
            />
          </div>
        ) : null}
        <CtaButton href={input.resultUrl}>See your checklist, sources and templates</CtaButton>
        {input.notTriggered.length > 0 ? <Text style={{ ...muted, margin: "0 0 10px" }}>Also checked, and not triggered by your answers: {input.notTriggered.join("; ")}.</Text> : null}
        {input.updatesUrl ? (
          <Text style={{ ...textStyle, fontSize: "14px" }}>
            <Link href={input.updatesUrl} style={linkStyle}>
              Confirm you want an email when these rules or dates change
            </Link>
          </Text>
        ) : null}
        {input.assumptions && input.assumptions.length > 0 ? (
          <>
            <Text style={{ ...muted, fontWeight: 600, margin: "18px 0 4px" }}>Assumptions</Text>
            {input.assumptions.map((a) => (
              <Text key={a} style={{ ...muted, margin: "0 0 4px" }}>
                {a}
              </Text>
            ))}
          </>
        ) : null}
        <Text style={{ ...muted, marginTop: "14px" }}>Rules as of {input.asOf}.</Text>
      </>
    ),
  };
}

export function docketUpdate(input: {
  caseName: string;
  court: string;
  docketUrl: string;
  why: string;
  entries: Array<{ date: string; number: string; text: string }>;
}): Template {
  const n = input.entries.length;
  const text = bullets([
    `${input.caseName}, ${input.court}.`,
    "",
    ...input.entries.map((e) => `- ${e.date}${e.number ? `, entry ${e.number}` : ""}: ${e.text}`),
    "",
    `Open the docket: ${input.docketUrl}`,
    input.why,
  ]);
  return {
    name: "docket-update",
    text,
    subject: `${n} new ${n === 1 ? "filing" : "filings"} in ${input.caseName}`,
    preview: input.entries[0]?.text.slice(0, 120) ?? input.caseName,
    body: (
      <>
        <Text style={{ ...textStyle, marginBottom: "10px" }}>
          <span style={{ fontWeight: 700 }}>{input.caseName}</span>
          <br />
          <span style={muted}>{input.court}</span>
        </Text>
        <ColorTable
          columns={["Filed", "Entry", "Filing"]}
          widths={["84px", "52px", undefined]}
          rows={input.entries.map((e) => ({ key: `${e.number}${e.date}`, tone: "blue", cells: [<span key="d" style={muted}>{e.date}</span>, e.number, e.text] }))}
        />
        <CtaButton href={input.docketUrl}>Open the docket</CtaButton>
        <Text style={muted}>{input.why}</Text>
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
