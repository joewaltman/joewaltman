import { getDb } from "@jw/db";
import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/subscriptions";

// RFC 8058 one-click unsubscribe. Mail clients POST here from the List-Unsubscribe header.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return new NextResponse("Missing token", { status: 400 });
  const email = await unsubscribeByToken(getDb(), token);
  if (!email) return new NextResponse("Unknown token", { status: 404 });
  return new NextResponse("Unsubscribed", { status: 200 });
}

// A plain visit gets the confirmation page instead of unsubscribing on GET.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  // Relative Location, so the proxy's internal host never leaks into the redirect.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `/u/${encodeURIComponent(token)}` },
  });
}
