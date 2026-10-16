import { type Db, type Tool, events } from "@jw/db";

export async function logEvent(
  db: Db,
  e: {
    type: string;
    tool?: Tool | null;
    subscriberId?: string | null;
    path?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(events).values({
    type: e.type,
    tool: e.tool ?? null,
    subscriberId: e.subscriberId ?? null,
    path: e.path ?? null,
    meta: e.meta ?? {},
  });
}
