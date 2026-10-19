/** @jsxRuntime automatic @jsxImportSource react */
// The pipeline runs this package through tsx, which only applies a tsconfig to files inside that
// config's include, so the JSX transform is pinned here rather than left to the caller's config.
import { Link, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { buttonStyle } from "./layout";

// Shared pieces for the tools' emails: plain tables and inline styles, which Gmail, Outlook and
// Apple Mail all render the same way.

export type Tone = "red" | "amber" | "green" | "blue" | "purple" | "gray";

export const TONES: Record<Tone, { fg: string; bg: string; bar: string }> = {
  red: { fg: "#b42318", bg: "#fef3f2", bar: "#d92d20" },
  amber: { fg: "#93370d", bg: "#fffaeb", bar: "#f79009" },
  green: { fg: "#05603a", bg: "#ecfdf3", bar: "#12b76a" },
  blue: { fg: "#1f4a6b", bg: "#eef4f9", bar: "#1f4a6b" },
  purple: { fg: "#5925dc", bg: "#f4f3ff", bar: "#7a5af8" },
  gray: { fg: "#475467", bg: "#f2f4f7", bar: "#98a2b3" },
};

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const muted: CSSProperties = { color: "#667085", fontSize: "13px", lineHeight: "1.45" };

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <span style={{ display: "inline-block", backgroundColor: t.bg, color: t.fg, borderRadius: "999px", padding: "3px 10px", fontSize: "13px", fontWeight: 600, margin: "0 6px 6px 0", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// A row of counts, such as "2 serious, 5 worth a look", as colored pills.
export function Summary({ items }: { items: Array<{ tone: Tone; text: string }> }) {
  if (items.length === 0) return null;
  return (
    <Text style={{ margin: "0 0 18px" }}>
      {items.map((i) => (
        <Pill key={i.text} tone={i.tone}>
          {i.text}
        </Pill>
      ))}
    </Text>
  );
}

export function Heading({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return (
    <Text
      style={{
        fontSize: "17px",
        fontWeight: 700,
        margin: "26px 0 10px",
        paddingLeft: tone ? "10px" : 0,
        borderLeft: tone ? `4px solid ${TONES[tone].bar}` : undefined,
        lineHeight: "1.3",
      }}
    >
      {children}
    </Text>
  );
}

export interface TableRow {
  key: string;
  // The colored bar at the start of the row.
  tone?: Tone;
  cells: ReactNode[];
}

// A table whose rows start with a thin colored bar. The first column takes the remaining width.
export function ColorTable({ columns, rows, widths }: { columns: string[]; rows: TableRow[]; widths?: Array<string | undefined> }) {
  const th: CSSProperties = { ...muted, fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #d0d5dd" };
  const td: CSSProperties = { fontFamily: font, fontSize: "14px", lineHeight: "1.45", verticalAlign: "top", padding: "9px 8px", borderBottom: "1px solid #eaecf0" };
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} role="presentation" style={{ borderCollapse: "collapse", margin: "0 0 8px" }}>
      <thead>
        <tr>
          <th style={{ ...th, width: "4px", padding: 0 }} />
          {columns.map((c, i) => (
            <th key={c || i} style={{ ...th, width: widths?.[i] }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td style={{ width: "4px", padding: 0, backgroundColor: r.tone ? TONES[r.tone].bar : "transparent", borderBottom: "1px solid #ffffff" }} />
            {r.cells.map((c, i) => (
              <td key={i} style={{ ...td, width: widths?.[i] }}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// A bold first line with an optional muted line under it, for table cells.
export function Lines({ main, sub, href }: { main: ReactNode; sub?: ReactNode; href?: string | null }) {
  return (
    <>
      <span style={{ fontWeight: 600 }}>{main}</span>
      {sub ? (
        <>
          <br />
          <span style={muted}>{sub}</span>
        </>
      ) : null}
      {href ? (
        <>
          <br />
          <Link href={href} style={{ color: "#1f4a6b", fontSize: "13px" }}>
            {href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </Link>
        </>
      ) : null}
    </>
  );
}

export function CtaButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Text style={{ margin: "22px 0 14px" }}>
      <Link href={href} style={buttonStyle}>
        {children}
      </Link>
    </Text>
  );
}

export function Callout({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} role="presentation" style={{ borderCollapse: "collapse", margin: "0 0 16px" }}>
      <tbody>
        <tr>
          <td style={{ width: "4px", padding: 0, backgroundColor: t.bar }} />
          <td style={{ backgroundColor: t.bg, padding: "12px 14px", fontFamily: font, fontSize: "14px", lineHeight: "1.5", color: "#1a1a1a" }}>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}

// Numbered steps with a colored number, as a table so it lines up in every client.
export function Steps({ items, tone }: { items: string[]; tone: Tone }) {
  const t = TONES[tone];
  return (
    <table width="100%" cellPadding={0} cellSpacing={0} role="presentation" style={{ borderCollapse: "collapse", margin: "0 0 10px" }}>
      <tbody>
        {items.map((item, i) => (
          <tr key={item}>
            <td style={{ width: "26px", verticalAlign: "top", padding: "4px 8px 8px 0" }}>
              <span style={{ display: "inline-block", width: "20px", height: "20px", lineHeight: "20px", borderRadius: "10px", backgroundColor: t.bg, color: t.fg, fontSize: "12px", fontWeight: 700, textAlign: "center", fontFamily: font }}>
                {i + 1}
              </span>
            </td>
            <td style={{ verticalAlign: "top", padding: "4px 0 8px", fontFamily: font, fontSize: "14px", lineHeight: "1.5" }}>{item}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
