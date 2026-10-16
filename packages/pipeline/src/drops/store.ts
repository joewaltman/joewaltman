import { gunzipSync, gzipSync } from "node:zlib";
import { manualDropSources } from "@jw/content";
import { type Db, type DropSource, manualDrops } from "@jw/db";
import { type ColumnMap, detectDelimiter, inSanDiego, mapColumns, splitLine } from "./table";

export class DropError extends Error {}

export interface StoredDrop {
  id: string;
  rowsSeen: number;
  rowsKept: number;
  matched: Record<string, string>;
}

// Reads an uploaded file line by line, checks its header, keeps San Diego County rows for
// statewide sources, and stores the result gzipped for the pipeline to pick up.
export async function storeDrop(db: Db, source: DropSource, fileName: string, lines: AsyncIterable<string> | Iterable<string>): Promise<StoredDrop> {
  const config = manualDropSources.sources[source];
  if (!config) throw new DropError(`Unknown source ${source}`);
  let header: string[] | null = null;
  let headerLine = "";
  let delimiter = ",";
  let map: ColumnMap | null = null;
  const kept: string[] = [];
  let rowsSeen = 0;
  for await (const raw of lines) {
    const line = raw.replace(/^﻿/, "").replace(/\r$/, "");
    if (!line.trim()) continue;
    if (!header) {
      delimiter = detectDelimiter(line);
      header = splitLine(line, delimiter);
      headerLine = line;
      map = mapColumns(config, header);
      if (map.missing.length > 0) {
        throw new DropError(
          `This file has no column for ${map.missing.join(", ")}. Its columns are: ${header.join(", ")}. Add the header name to content/manual-drops.json or upload the right file.`,
        );
      }
      continue;
    }
    rowsSeen++;
    if (config.statewide && !inSanDiego(splitLine(line, delimiter), map!)) continue;
    kept.push(line);
  }
  if (!header || !map) throw new DropError("The file is empty.");
  const content = gzipSync(Buffer.from([headerLine, ...kept].join("\n"), "utf8"));
  const [row] = await db
    .insert(manualDrops)
    .values({ source, fileName: fileName.slice(0, 200), rowsSeen, rowsKept: kept.length, content, result: { matched: map.matched } })
    .returning({ id: manualDrops.id });
  return { id: row!.id, rowsSeen, rowsKept: kept.length, matched: map.matched };
}

export function dropText(content: Buffer): string {
  return gunzipSync(content).toString("utf8");
}

// Splits a text stream into lines, for the upload route.
export async function* streamLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const parts = rest.split("\n");
    rest = parts.pop() ?? "";
    yield* parts;
  }
  rest += decoder.decode();
  if (rest) yield rest;
}
