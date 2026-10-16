import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Models named in the build spec: Sonnet-class for summaries, Haiku-class for bulk classification.
export const SUMMARY_MODEL = "claude-sonnet-5-5";
export const CLASSIFY_MODEL = "claude-haiku-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type LlmClient = Pick<Anthropic, "messages" | "beta">;

// Null when no key is configured; callers skip enrichment instead of failing.
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  return env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
}

// Token spend per model, written into the job_runs row.
export class UsageLog {
  readonly byModel: Record<string, { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; refusals: number }> = {};

  add(model: string, usage: Anthropic.Usage | Anthropic.Beta.BetaUsage | undefined, refused = false) {
    const m = (this.byModel[model] ??= { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, refusals: 0 });
    m.requests++;
    if (refused) m.refusals++;
    if (!usage) return;
    m.input += usage.input_tokens ?? 0;
    m.output += usage.output_tokens ?? 0;
    m.cacheRead += usage.cache_read_input_tokens ?? 0;
    m.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  }
}

function firstText(content: Array<{ type: string; text?: string }>): string | null {
  for (const block of content) if (block.type === "text" && typeof block.text === "string") return block.text;
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Copy rule for anything the model writes that a person will read.
export function cleanCopy(text: string, maxLength = 140): string {
  const t = text.replace(/\s*\u2014\s*/g, ", ").replace(/\s+/g, " ").trim();
  return t.length > maxLength ? `${t.slice(0, maxLength - 1).trimEnd()}.` : t;
}

export interface ClassifyItem {
  id: string;
  name: string;
  // Anything that hints at what the business does: license type, NAICS description, DBA.
  hints: string[];
}

const CLASSIFY_SYSTEM = `You sort newly registered San Diego County businesses into categories for a business directory.
For each business, pick the single best category id from the list, or "other" when none fits or the facts are too thin to tell.
Use only the name and hints given. Do not guess from a person's name.`;

// Bulk category assignment with the Haiku-class model. Returns id to category id (null for "other").
export async function classifyBusinesses(
  client: LlmClient,
  items: ClassifyItem[],
  categories: Array<{ id: string; label: string }>,
  usage: UsageLog,
): Promise<Map<string, string | null>> {
  const ids = [...categories.map((c) => c.id), "other"];
  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, category: { type: "string", enum: ids } },
          required: ["index", "category"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
  const parsed = z.object({ results: z.array(z.object({ index: z.number().int(), category: z.string() })) });
  const categoryList = categories.map((c) => `${c.id}: ${c.label}`).join("\n");
  const out = new Map<string, string | null>();

  for (const batch of chunk(items, 50)) {
    const lines = batch.map((b, i) => `${i}. ${b.name}${b.hints.length ? ` | ${b.hints.join("; ")}` : ""}`).join("\n");
    const response = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: [{ type: "text", text: `${CLASSIFY_SYSTEM}\n\nCategories:\n${categoryList}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Businesses:\n${lines}` }],
    });
    const refused = response.stop_reason === "refusal";
    usage.add(CLASSIFY_MODEL, response.usage, refused);
    if (refused) continue;
    const text = firstText(response.content);
    const result = text ? parsed.safeParse(JSON.parse(text)) : null;
    if (!result?.success) continue;
    for (const r of result.data.results) {
      const item = batch[r.index];
      if (item && ids.includes(r.category)) out.set(item.id, r.category === "other" ? null : r.category);
    }
  }
  return out;
}

export interface SummaryItem {
  id: string;
  facts: string[];
}

const SUMMARY_SYSTEM = `You write one-line descriptions of newly registered businesses for a weekly list read by bankers, CPAs and insurance agents.
Rules:
- One plain sentence, at most 14 words.
- Use only the facts given. No guesses about size, quality, history, owners or plans.
- Never include a person's name, even when it is part of the business name.
- No hype words, no exclamation marks, no em dashes.
Example: "Caterer in Serra Mesa with a new City of San Diego business tax certificate."`;

// One-line summaries with the Sonnet-class model. Returns id to summary.
export async function summarizeBusinesses(
  client: LlmClient,
  items: SummaryItem[],
  usage: UsageLog,
): Promise<Map<string, string>> {
  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, summary: { type: "string" } },
          required: ["index", "summary"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
  const parsed = z.object({ results: z.array(z.object({ index: z.number().int(), summary: z.string() })) });
  const out = new Map<string, string>();

  for (const batch of chunk(items, 25)) {
    const lines = batch.map((b, i) => `${i}. ${b.facts.join("; ")}`).join("\n");
    // Server-side fallback: if this model declines on policy grounds, the API retries on the
    // recommended substitute inside the same call.
    const response = await client.beta.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 4000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: [{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Businesses:\n${lines}` }],
    });
    const refused = response.stop_reason === "refusal";
    usage.add(SUMMARY_MODEL, response.usage, refused);
    if (refused) continue;
    const text = firstText(response.content);
    const result = text ? parsed.safeParse(JSON.parse(text)) : null;
    if (!result?.success) continue;
    for (const r of result.data.results) {
      const item = batch[r.index];
      const summary = cleanCopy(r.summary);
      if (item && summary) out.set(item.id, summary);
    }
  }
  return out;
}
