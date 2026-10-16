import { DROP_SOURCES, getDb } from "@jw/db";
import { DropError, storeDrop, streamLines } from "@jw/pipeline/drops";
import { sameOrigin } from "@/lib/same-origin";
import { currentAdmin } from "@/lib/server";

// Raw file upload from /admin/drops. Streams line by line, so a statewide file never sits in memory.
export async function POST(request: Request) {
  if (!(await currentAdmin())) return Response.json({ error: "Sign in again at /admin/login." }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const source = DROP_SOURCES.find((s) => s === url.searchParams.get("source"));
  const name = url.searchParams.get("name") ?? "upload";
  if (!source) return Response.json({ error: "Pick a source." }, { status: 400 });
  if (!request.body) return Response.json({ error: "The file was empty." }, { status: 400 });
  const body = /\.gz$/i.test(name) ? request.body.pipeThrough(new DecompressionStream("gzip")) : request.body;
  try {
    const stored = await storeDrop(getDb(), source, name, streamLines(body as ReadableStream<Uint8Array>));
    return Response.json(stored);
  } catch (err) {
    if (err instanceof DropError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
