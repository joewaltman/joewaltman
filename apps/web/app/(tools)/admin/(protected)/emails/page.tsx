import { desc, emailSends, getDb } from "@jw/db";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";

export default async function EmailsPage() {
  await requireAdmin();
  const rows = await getDb().select().from(emailSends).orderBy(desc(emailSends.createdAt)).limit(300);
  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Email log</h1>
      <DataTable
        rows={rows}
        empty="No emails logged yet."
        columns={[
          { key: "createdAt", label: "When" },
          { key: "toEmail", label: "To" },
          { key: "template", label: "Template" },
          { key: "mode", label: "Mode" },
          { key: "status", label: "Status" },
          { key: "error", label: "Error" },
        ]}
      />
    </div>
  );
}
