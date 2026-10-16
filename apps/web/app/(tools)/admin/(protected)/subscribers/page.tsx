import { desc, eq, getDb, partners, subscribers, subscriptions } from "@jw/db";
import { DataTable } from "@/components/data-table";
import { requireAdmin } from "@/lib/server";

export default async function SubscribersPage() {
  await requireAdmin();
  const db = getDb();
  const [people, subs] = await Promise.all([
    db
      .select({
        id: subscribers.id,
        email: subscribers.email,
        name: subscribers.name,
        company: subscribers.company,
        role: subscribers.role,
        partner: partners.slug,
        confirmedAt: subscribers.confirmedAt,
        unsubscribedAt: subscribers.unsubscribedAt,
        createdAt: subscribers.createdAt,
      })
      .from(subscribers)
      .leftJoin(partners, eq(subscribers.partnerId, partners.id))
      .orderBy(desc(subscribers.createdAt))
      .limit(1000),
    db.select().from(subscriptions),
  ]);
  const toolsBySubscriber = new Map<string, string[]>();
  for (const s of subs) {
    const list = toolsBySubscriber.get(s.subscriberId) ?? [];
    list.push(s.active ? s.tool : `${s.tool} (pending)`);
    toolsBySubscriber.set(s.subscriberId, list);
  }
  const rows = people.map((p) => ({ ...p, tools: toolsBySubscriber.get(p.id)?.join(", ") ?? "" }));

  return (
    <div>
      <h1 className="mb-6 text-[1.75rem] font-semibold">Subscribers</h1>
      <DataTable
        rows={rows}
        empty="No subscribers yet."
        columns={[
          { key: "email", label: "Email" },
          { key: "name", label: "Name" },
          { key: "company", label: "Company" },
          { key: "role", label: "Role" },
          { key: "partner", label: "Partner" },
          { key: "tools", label: "Tools" },
          { key: "confirmedAt", label: "Confirmed" },
          { key: "unsubscribedAt", label: "Unsubscribed" },
        ]}
      />
    </div>
  );
}
