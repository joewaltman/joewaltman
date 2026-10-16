import { taxonomy } from "@jw/content";
import { and, entities, entityIdentifiers, eq, gt, inArray, isNull } from "@jw/db";
import { type LlmClient, UsageLog, classifyBusinesses, clientFromEnv, summarizeBusinesses } from "@jw/llm";
import type { Job, JobContext } from "./runner";

// Bounds the cost of one run. New entities arrive at a few hundred a day.
export const ENRICH_LIMIT = 200;
const WINDOW_DAYS = 30;

// Fields in a source record that say what the business does. Extend as adapters are added.
const HINT_KEYS = ["naics_description", "license_type_description", "license_type", "classifications", "classification"];

const TYPE_LABEL: Record<string, string> = {
  corporation: "corporation",
  llc: "LLC",
  partnership: "partnership",
  sole_prop: "sole proprietor",
  nonprofit: "nonprofit",
  government: "government agency",
};

function hintsFrom(raws: Array<Record<string, unknown>>): string[] {
  const hints = new Set<string>();
  for (const raw of raws) {
    for (const key of HINT_KEYS) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) hints.add(v.trim().toLowerCase());
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.trim()) hints.add(x.trim().toLowerCase());
    }
  }
  return [...hints];
}

async function rawsByEntity(ctx: JobContext, ids: string[]) {
  const map = new Map<string, Array<Record<string, unknown>>>();
  if (ids.length === 0) return map;
  const rows = await ctx.db
    .select({ entityId: entityIdentifiers.entityId, raw: entityIdentifiers.raw })
    .from(entityIdentifiers)
    .where(inArray(entityIdentifiers.entityId, ids));
  for (const r of rows) map.set(r.entityId, [...(map.get(r.entityId) ?? []), r.raw]);
  return map;
}

export function enrichJob(makeClient: () => LlmClient | null = clientFromEnv): Job {
  return {
    name: "enrich",
    async run(ctx) {
      const client = makeClient();
      if (!client) {
        ctx.log("enrich: ANTHROPIC_API_KEY is not set, so enrichment was skipped");
        return { rowsIn: 0, rowsUpserted: 0, events: 0, meta: { skipped: "ANTHROPIC_API_KEY not set" } };
      }
      const usage = new UsageLog();
      const since = new Date(ctx.now.getTime() - WINDOW_DAYS * 86_400_000);
      const labels = new Map(taxonomy.categories.map((c) => [c.id, c.label]));

      const toClassify = await ctx.db
        .select({ id: entities.id, name: entities.canonicalName, dba: entities.dba })
        .from(entities)
        .where(and(isNull(entities.category), gt(entities.createdAt, since)))
        .limit(ENRICH_LIMIT);
      const classifyRaws = await rawsByEntity(ctx, toClassify.map((e) => e.id));
      const categories = await classifyBusinesses(
        client,
        toClassify.map((e) => ({
          id: e.id,
          name: e.dba ? `${e.name} (doing business as ${e.dba})` : e.name,
          hints: hintsFrom(classifyRaws.get(e.id) ?? []),
        })),
        taxonomy.categories,
        usage,
      );
      for (const [id, category] of categories) {
        // "other" is stored too, so the same business is not sent again tomorrow.
        await ctx.db.update(entities).set({ category: category ?? taxonomy.fallback.id }).where(eq(entities.id, id));
      }

      const toSummarize = await ctx.db
        .select()
        .from(entities)
        .where(and(isNull(entities.summary), gt(entities.createdAt, since)))
        .limit(ENRICH_LIMIT);
      const summaryRaws = await rawsByEntity(ctx, toSummarize.map((e) => e.id));
      const summaries = await summarizeBusinesses(
        client,
        toSummarize.map((e) => ({
          id: e.id,
          facts: [
            e.dba ?? e.canonicalName,
            e.entityType ? TYPE_LABEL[e.entityType] ?? e.entityType : null,
            e.category ? `category: ${labels.get(e.category) ?? e.category}` : null,
            e.city ? `in ${e.city}` : null,
            ...hintsFrom(summaryRaws.get(e.id) ?? []),
          ].filter((f): f is string => Boolean(f)),
        })),
        usage,
      );
      for (const [id, summary] of summaries) {
        await ctx.db.update(entities).set({ summary }).where(eq(entities.id, id));
      }

      return {
        rowsIn: toClassify.length + toSummarize.length,
        rowsUpserted: categories.size + summaries.size,
        events: 0,
        meta: { classified: categories.size, summarized: summaries.size, llm: usage.byModel },
      };
    },
  };
}
