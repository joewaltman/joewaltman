import { TOOLS, asc, count, eq, getDb, partners, subscribers } from "@jw/db";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";
import { TOOL_INFO } from "@/lib/tools";

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;
  const db = getDb();
  const rows = await db
    .select({
      id: partners.id,
      slug: partners.slug,
      name: partners.name,
      tool: partners.tool,
      contactEmail: partners.contactEmail,
      signups: count(subscribers.id),
    })
    .from(partners)
    .leftJoin(subscribers, eq(subscribers.partnerId, partners.id))
    .groupBy(partners.id)
    .orderBy(asc(partners.slug));

  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Partners</h1>
      <DataTable
        rows={rows}
        empty="No partners yet."
        columns={[
          { key: "slug", label: "Slug" },
          { key: "name", label: "Name" },
          { key: "tool", label: "Tool" },
          { key: "contactEmail", label: "Contact" },
          { key: "signups", label: "Signups" },
        ]}
      />

      <h2 className="mt-10 mb-3 font-semibold">Add or update a partner</h2>
      {error ? <p className="notice">{error}</p> : null}
      <form method="post" action="/api/forms/admin-partner" className="grid max-w-md gap-3">
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Slug (used in /p/slug links)</span>
          <input className="field" name="slug" required pattern="[a-z0-9-]{2,60}" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Name</span>
          <input className="field" name="name" required />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Contact email</span>
          <input className="field" name="contactEmail" type="email" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Logo URL</span>
          <input className="field" name="logoUrl" type="url" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Booking link (optional; AI-at-Work partners)</span>
          <input className="field" name="bookingUrl" type="url" />
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Tool</span>
          <select className="field" name="tool" defaultValue="">
            <option value="">Any</option>
            {TOOLS.map((t) => (
              <option key={t} value={t}>
                {TOOL_INFO[t].name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[0.95rem] font-semibold">Notes</span>
          <textarea className="field" name="notes" rows={3} />
        </label>
        <div>
          <button type="submit" className="btn">
            Save partner
          </button>
        </div>
      </form>
    </div>
  );
}
