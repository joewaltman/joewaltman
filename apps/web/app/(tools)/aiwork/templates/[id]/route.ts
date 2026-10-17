import { aiworkRules, templateText } from "@jw/content";
import { currentAdmin } from "@/lib/server";

// Notice templates as plain-text downloads. Until a template's facts are confirmed, only Joe can get it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audience = (await currentAdmin()) ? "admin" : "public";
  const t = templateText(aiworkRules, id, audience);
  if (!t) return new Response("This template is not available yet.", { status: 404 });
  return new Response(t.text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.fileName}"`,
    },
  });
}
