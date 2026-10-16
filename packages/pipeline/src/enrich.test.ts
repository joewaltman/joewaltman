import { type Db, entities } from "@jw/db";
import { createTestDb } from "@jw/db/testing";
import type { LlmClient } from "@jw/llm";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryArchive } from "./archive";
import { enrichJob } from "./enrich";
import { addEvent, upsertEntity } from "./resolve";
import type { JobContext } from "./runner";

let db: Db;
let ctx: JobContext;
const prompts: string[] = [];

const client = {
  messages: {
    async create(body: { messages: Array<{ content: string }> }) {
      prompts.push(body.messages[0]!.content);
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ results: [{ index: 0, category: "construction" }] }) }],
        usage: { input_tokens: 50, output_tokens: 10 },
      };
    },
  },
  beta: {
    messages: {
      async create(body: { messages: Array<{ content: string }> }) {
        prompts.push(body.messages[0]!.content);
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ results: [{ index: 0, summary: "Roofing contractor in Oceanside." }] }) }],
          usage: { input_tokens: 80, output_tokens: 12 },
        };
      },
    },
  },
} as unknown as LlmClient;

beforeEach(async () => {
  db = await createTestDb();
  prompts.length = 0;
  ctx = { db, archive: memoryArchive(), email: undefined as never, now: new Date(), fetch: async () => new Response(""), log: () => {} };
});

describe("enrich", () => {
  it("skips cleanly without an API key", async () => {
    const out = await enrichJob(() => null).run(ctx);
    expect(out.meta).toEqual({ skipped: "ANTHROPIC_API_KEY not set" });
  });

  it("classifies and summarizes entities with recent events and logs token use", async () => {
    // A business with no event, as after a source's first load, is left alone.
    await upsertEntity(db, { source: "abc", sourceId: "9", name: "Old Liquor Store Inc", zip: "92101", raw: {} });
    const { entityId } = await upsertEntity(db, {
      source: "sd_biztax",
      sourceId: "1",
      name: "Coastal Roof Pros LLC",
      entityType: "llc",
      city: "Oceanside",
      zip: "92054",
      raw: { naics_description: "ROOFING CONTRACTORS" },
    });
    await addEvent(db, {
      entityId,
      source: "sd_biztax",
      eventType: "new_business",
      eventDate: "2026-10-15",
      severity: "info",
      title: "New",
      dedupeKey: "t:1",
    });
    const out = await enrichJob(() => client).run(ctx);
    expect(out.meta).toMatchObject({ classified: 1, summarized: 1 });
    expect(out.meta!.llm).toMatchObject({
      "claude-haiku-5-5": { requests: 1, input: 50, output: 10 },
      "claude-sonnet-5-5": { requests: 1, input: 80, output: 12 },
    });
    expect(prompts[0]).toContain("roofing contractors");
    const rows = await db.select().from(entities);
    expect(rows.find((e) => e.id === entityId)).toMatchObject({ category: "construction", summary: "Roofing contractor in Oceanside." });
    expect(rows.find((e) => e.id !== entityId)).toMatchObject({ category: null, summary: null });

    // A second run has nothing left to do.
    prompts.length = 0;
    const again = await enrichJob(() => client).run(ctx);
    expect(again.rowsIn).toBe(0);
    expect(prompts).toHaveLength(0);
  });
});
