import { desc, getDb, jobRuns } from "@jw/db";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";

export default async function JobsPage() {
  await requireAdmin();
  const rows = await getDb().select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(300);
  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Job runs</h1>
      <DataTable
        rows={rows}
        empty="No ingestion jobs have run yet. They start in the ingestion phase."
        columns={[
          { key: "job", label: "Job" },
          { key: "status", label: "Status" },
          { key: "startedAt", label: "Started" },
          { key: "finishedAt", label: "Finished" },
          { key: "rowsIn", label: "Rows in" },
          { key: "rowsUpserted", label: "Upserted" },
          { key: "error", label: "Error" },
        ]}
      />
    </div>
  );
}
