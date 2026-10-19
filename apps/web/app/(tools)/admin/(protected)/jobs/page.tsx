import { desc, getDb, isNull, jobRequests, jobRuns } from "@jw/db";
import { JOB_INFO, whenItRuns } from "@jw/pipeline/job-list";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";

const when = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ queued?: string }> }) {
  await requireAdmin();
  const { queued } = await searchParams;
  const db = getDb();
  const [rows, pending] = await Promise.all([
    db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(300),
    db.select({ job: jobRequests.job }).from(jobRequests).where(isNull(jobRequests.startedAt)),
  ]);
  const waiting = new Set(pending.map((p) => p.job));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.job)) latest.set(r.job, r);

  return (
    <div>
      <h1 className="mb-2 text-[1.75rem] font-semibold">Jobs</h1>
      <p className="mb-6 text-[0.95rem] text-muted">
        The pipeline checks every 30 minutes. "Run now" queues a job for its next check, so it starts within half an
        hour; a failure emails you as usual.
      </p>
      {queued && JOB_INFO[queued] ? <p className="notice">Queued {queued}. It starts within 30 minutes; refresh this page to see the result.</p> : null}

      <div className="mb-10 overflow-x-auto">
        <table className="w-full border-collapse text-[0.95rem]">
          <thead>
            <tr className="border-b border-rule text-left text-[0.85rem] text-muted">
              <th className="py-2 pr-4 font-semibold">Job</th>
              <th className="py-2 pr-4 font-semibold">Runs</th>
              <th className="py-2 pr-4 font-semibold">Last run</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {Object.entries(JOB_INFO).map(([name, what]) => {
              const last = latest.get(name);
              return (
                <tr key={name} className="border-b border-rule align-top">
                  <td className="py-2.5 pr-4">
                    <span className="font-semibold">{name}</span>
                    <div className="text-[0.85rem] text-muted">{what}</div>
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap text-muted">{whenItRuns(name)}</td>
                  <td className="py-2.5 pr-4">
                    {last ? (
                      <>
                        <span className={last.status === "failed" ? "font-semibold text-red-800" : last.status === "running" ? "font-semibold" : ""}>
                          {last.status === "success" ? "OK" : last.status === "failed" ? "Failed" : "Running"}
                        </span>{" "}
                        <span className="text-muted">{when(last.startedAt)}</span>
                        {last.status === "failed" && last.error ? <div className="max-w-md text-[0.85rem] text-muted">{last.error.split("\n")[0]}</div> : null}
                      </>
                    ) : (
                      <span className="text-muted">Not run yet</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {waiting.has(name) ? (
                      <span className="text-[0.9rem] text-muted">Queued</span>
                    ) : (
                      <form method="post" action="/api/forms/admin-run-job">
                        <input type="hidden" name="job" value={name} />
                        <button type="submit" className="cursor-pointer text-[0.9rem] text-accent underline">
                          Run now
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-[1.2rem] font-semibold">Recent runs</h2>
      <DataTable
        rows={rows.slice(0, 100)}
        empty="No jobs have run yet."
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
