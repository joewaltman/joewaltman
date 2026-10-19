import { unzipSync } from "fflate";

// Rows of the first worksheet in an .xlsx file, as text. Enough for the plain data exports state
// agencies post: shared and inline strings, and numbers (dates come through as Excel day numbers).
export function xlsxRows(body: Uint8Array): string[][] {
  const files = unzipSync(body);
  const name = (re: RegExp) => Object.keys(files).find((n) => re.test(n));
  const sheetName = name(/^xl\/worksheets\/sheet1\.xml$/i) ?? name(/^xl\/worksheets\/[^/]+\.xml$/i);
  if (!sheetName) throw new Error("xlsx file has no worksheet");
  const decode = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : "");
  const unescape = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
  const text = (xml: string) => unescape(xml.replace(/<[^>]+>/g, ""));

  const sharedXml = decode(files[name(/^xl\/sharedStrings\.xml$/i) ?? ""]);
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]!));
  const column = (ref: string) => {
    let n = 0;
    for (const ch of ref.match(/^[A-Z]+/)![0]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows: string[][] = [];
  const sheet = decode(files[sheetName]);
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = c[2]!.match(/t="(\w+)"/)?.[1] ?? "n";
      const inner = c[3] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      cells[column(c[1]!)] = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? text(inner) : v !== undefined ? unescape(v) : "";
    }
    rows.push(Array.from(cells, (x) => (x ?? "").trim()));
  }
  return rows;
}

// Excel day number to MM-DD-YYYY, the form the DCA text files use.
export function excelDate(serial: string): string {
  const days = Math.floor(Number(serial));
  if (!Number.isFinite(days) || days < 1) return serial;
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}-${d.getUTCFullYear()}`;
}
