import { aiworkRules } from "@jw/content";
import { reviewPacket } from "@/lib/aiwork-packet";
import { currentAdmin } from "@/lib/server";

export async function GET() {
  if (!(await currentAdmin())) return new Response("Sign in at /admin/login first.", { status: 401 });
  return new Response(reviewPacket(aiworkRules), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="aiwork-rules-review-${aiworkRules.version}.txt"`,
    },
  });
}
