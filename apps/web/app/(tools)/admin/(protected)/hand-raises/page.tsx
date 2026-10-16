import { desc, getDb, handRaises } from "@jw/db";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";
import { TOOL_INFO } from "@/lib/tools";

export default async function HandRaisesPage() {
  await requireAdmin();
  const rows = await getDb().select().from(handRaises).orderBy(desc(handRaises.createdAt)).limit(500);
  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Hand-raises</h1>
      <DataTable
        rows={rows}
        empty="No hand-raises yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "tool", label: "Tool", render: (r) => TOOL_INFO[r.tool as keyof typeof TOOL_INFO]?.name },
          {
            key: "email",
            label: "Email",
            render: (r) => (r.email ? <a href={`mailto:${r.email}`}>{String(r.email)}</a> : "anonymous"),
          },
          { key: "context", label: "Context" },
          {
            key: "handledAt",
            label: "Handled",
            render: (r) =>
              r.handledAt ? (
                "yes"
              ) : (
                <form method="post" action="/api/forms/admin-hand-raise-handled">
                  <input type="hidden" name="id" value={String(r.id)} />
                  <button type="submit" className="cursor-pointer text-accent underline">
                    Mark handled
                  </button>
                </form>
              ),
          },
        ]}
      />
    </div>
  );
}
