import { describe, expect, it } from "vitest";
import { CLASSIFY_MODEL, type LlmClient, SUMMARY_MODEL, UsageLog, classifyBusinesses, cleanCopy, summarizeBusinesses } from "./index";

// A stand-in for the SDK client that records requests and replays canned responses.
function fakeClient(reply: (body: Record<string, unknown>) => { text?: string; stop_reason?: string }) {
  const calls: Array<{ api: "messages" | "beta"; body: Record<string, unknown> }> = [];
  const respond = (api: "messages" | "beta") => async (body: Record<string, unknown>) => {
    calls.push({ api, body });
    const r = reply(body);
    return {
      stop_reason: r.stop_reason ?? "end_turn",
      content: r.text ? [{ type: "text", text: r.text }] : [],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  };
  const client = { messages: { create: respond("messages") }, beta: { messages: { create: respond("beta") } } };
  return { client: client as unknown as LlmClient, calls };
}

const categories = [
  { id: "restaurants-bars", label: "Restaurants" },
  { id: "construction", label: "Construction" },
];

describe("classifyBusinesses", () => {
  it("uses the Haiku-class model with a schema and maps results back by index", async () => {
    const { client, calls } = fakeClient(() => ({
      text: JSON.stringify({ results: [{ index: 0, category: "construction" }, { index: 1, category: "other" }] }),
    }));
    const usage = new UsageLog();
    const out = await classifyBusinesses(
      client,
      [
        { id: "a", name: "Coastal Roofing", hints: ["roofing contractor"] },
        { id: "b", name: "Blue Door", hints: [] },
      ],
      categories,
      usage,
    );
    expect(out).toEqual(new Map([["a", "construction"], ["b", null]]));
    expect(calls[0]!.api).toBe("messages");
    expect(calls[0]!.body.model).toBe(CLASSIFY_MODEL);
    expect(JSON.stringify(calls[0]!.body.output_config)).toContain('"enum":["restaurants-bars","construction","other"]');
    expect(usage.byModel[CLASSIFY_MODEL]).toMatchObject({ requests: 1, input: 100, output: 20 });
  });

  it("skips a refused batch instead of failing", async () => {
    const { client } = fakeClient(() => ({ stop_reason: "refusal" }));
    const usage = new UsageLog();
    const out = await classifyBusinesses(client, [{ id: "a", name: "X", hints: [] }], categories, usage);
    expect(out.size).toBe(0);
    expect(usage.byModel[CLASSIFY_MODEL]!.refusals).toBe(1);
  });
});

describe("summarizeBusinesses", () => {
  it("uses the Sonnet-class model with server-side fallback and cleans the copy", async () => {
    const { client, calls } = fakeClient(() => ({
      text: JSON.stringify({ results: [{ index: 0, summary: "Caterer in Serra Mesa \u2014 new city tax certificate." }] }),
    }));
    const usage = new UsageLog();
    const out = await summarizeBusinesses(client, [{ id: "a", facts: ["The Cooking Penguin", "caterers"] }], usage);
    expect(out.get("a")).toBe("Caterer in Serra Mesa, new city tax certificate.");
    expect(calls[0]!.api).toBe("beta");
    expect(calls[0]!.body).toMatchObject({ model: SUMMARY_MODEL, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });

  it("batches 25 at a time", async () => {
    const { client, calls } = fakeClient(() => ({ text: JSON.stringify({ results: [] }) }));
    const items = Array.from({ length: 60 }, (_, i) => ({ id: String(i), facts: [`Business ${i}`] }));
    await summarizeBusinesses(client, items, new UsageLog());
    expect(calls).toHaveLength(3);
  });
});

describe("cleanCopy", () => {
  it("removes em dashes and caps length", () => {
    expect(cleanCopy("A \u2014 B")).toBe("A, B");
    expect(cleanCopy("x".repeat(200), 20)).toHaveLength(20);
  });
});
