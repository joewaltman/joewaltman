import { type Db, and, asc, count, eq, manualDrops } from "@jw/db";
import type { Job } from "../runner";
import { processDrop } from "./process";
import { dropText } from "./store";

export async function pendingDrops(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(manualDrops).where(eq(manualDrops.status, "pending"));
  return row?.n ?? 0;
}

// Reads every uploaded file still waiting, oldest first. A file that fails is marked failed with
// the reason, and the run fails afterward so Joe gets the usual failure email.
export function manualDropsJob(): Job {
  return {
    name: "manual-drops",
    async run(ctx) {
      const pending = await ctx.db.select().from(manualDrops).where(eq(manualDrops.status, "pending")).orderBy(asc(manualDrops.uploadedAt));
      let rowsIn = 0;
      let rowsUpserted = 0;
      let events = 0;
      const failures: string[] = [];
      for (const drop of pending) {
        try {
          const result = await processDrop(ctx.db, drop.source, dropText(drop.content), ctx.now);
          rowsIn += result.rows;
          rowsUpserted += result.upserted;
          events += result.events;
          await ctx.db
            .update(manualDrops)
            .set({ status: "processed", processedAt: new Date(), result: { ...drop.result, ...result } })
            .where(and(eq(manualDrops.id, drop.id), eq(manualDrops.status, "pending")));
          ctx.log(`manual-drops: ${drop.source} ${drop.fileName}: ${result.rows} rows, ${result.events} events`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${drop.source} ${drop.fileName}: ${message}`);
          await ctx.db.update(manualDrops).set({ status: "failed", processedAt: new Date(), error: message.slice(0, 2000) }).where(eq(manualDrops.id, drop.id));
        }
      }
      if (failures.length > 0) throw new Error(`Manual drops failed: ${failures.join("; ")}`);
      return { rowsIn, rowsUpserted, events, meta: { drops: pending.length } };
    },
  };
}
