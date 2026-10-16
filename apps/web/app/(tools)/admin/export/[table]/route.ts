import { getDb } from "@jw/db";
import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { currentAdmin } from "@/lib/server";
import { EXPORTS, type ExportTable } from "./tables";

export async function GET(_request: Request, { params }: { params: Promise<{ table: string }> }) {
  if (!(await currentAdmin())) return new NextResponse("Not found", { status: 404 });
  const { table } = await params;
  if (!Object.hasOwn(EXPORTS, table)) return new NextResponse("Not found", { status: 404 });
  const rows = await getDb().select().from(EXPORTS[table as ExportTable]);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows as Array<Record<string, unknown>>), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
