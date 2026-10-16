import { getDb } from "@jw/db";
import { buildDigest, digestCsv, digestWindow } from "@jw/radar";
import { pickAreas } from "@/lib/radar-admin";
import { currentAdmin } from "@/lib/server";

// Last week's digest for any areas, for Joe. Subscribers get their own signed links instead.
export async function GET(request: Request) {
  if (!(await currentAdmin())) return new Response("Sign in at /admin/login first.", { status: 401 });
  const clusters = pickAreas(new URL(request.url).searchParams.getAll("areas"));
  const window = digestWindow(new Date());
  const digest = await buildDigest(getDb(), { ...window, clusters });
  return new Response(digestCsv(digest), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="new-business-radar-${window.end}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
