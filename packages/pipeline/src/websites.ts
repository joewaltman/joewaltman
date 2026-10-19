import { and, entities, entityEvents, eq, gt, inArray, isNull, sql } from "@jw/db";
import { looksLikePerson, normalizeName } from "./normalize";
import type { Job, JobContext } from "./runner";

// The spec's optional website guess: for each recent new business, try the obvious .com names and
// keep one only when the page is a real site that names the business and says where it is.
const RECENT_DAYS = 30;
const PER_RUN = 150;
const PARALLEL = 6;
const MAX_BYTES = 300_000;

// "Leucadia Cafe LLC" -> leucadiacafe.com, leucadia-cafe.com. Generic or very short names are left out.
export function candidateDomains(names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const name of names) {
    // Accented letters would be dropped, not transliterated, so such names are not guessed.
    if (!name || looksLikePerson(name) || /[^\x00-\x7F]/.test(name)) continue;
    const words = normalizeName(name).toLowerCase().split(" ").filter(Boolean);
    const joined = words.join("");
    if (!/^[a-z0-9]+$/.test(joined) || joined.length < 6 || joined.length > 30) continue;
    if (words.length === 1 && joined.length < 8) continue;
    for (const d of [`${joined}.com`, words.length > 1 ? `${words.join("-")}.com` : null]) if (d && !out.includes(d)) out.push(d);
  }
  return out.slice(0, 4);
}

const PARKED =
  /domain (name )?(is |may be )?for sale|buy this domain|this domain is parked|parked (free|domain)|hugedomains|sedoparking|sedo\.com|dan\.com|afternic|godaddy\.com\/domainsearch|domain parking|related searches/i;

export interface SiteCheck {
  name: string;
  dba: string | null;
  city: string | null;
  zip: string | null;
}

// Whether a fetched page is this business's site: not parked, names it, and mentions where it is.
export function pageMatches(html: string, b: SiteCheck): boolean {
  if (PARKED.test(html)) return false;
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  const flat = normalizeName(text);
  const named = [b.dba, b.name].some((n) => {
    const target = normalizeName(n);
    return target.length > 0 && ` ${flat} `.includes(` ${target} `);
  });
  if (!named) return false;
  const upper = text.toUpperCase();
  const local = [b.city, b.zip, "SAN DIEGO", "CALIFORNIA", ", CA"].filter((x): x is string => Boolean(x)).some((x) => upper.includes(x.toUpperCase()));
  return local;
}

async function fetchPage(ctx: JobContext, domain: string): Promise<{ url: string; html: string } | null> {
  try {
    const res = await ctx.fetch(`https://${domain}/`, {
      headers: { "User-Agent": "joewaltman.com website check (joe@joewaltman.com)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "text/html").includes("html") || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    while (html.length < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return { url: res.url || `https://${domain}/`, html };
  } catch {
    return null;
  }
}

export function websitesJob(): Job {
  return {
    name: "websites",
    async run(ctx) {
      const since = new Date(ctx.now.getTime() - RECENT_DAYS * 86_400_000);
      const recent = ctx.db
        .select({ id: entityEvents.entityId })
        .from(entityEvents)
        .where(and(eq(entityEvents.eventType, "new_business"), gt(entityEvents.createdAt, since)));
      const todo = await ctx.db
        .select({ id: entities.id, name: entities.canonicalName, dba: entities.dba, city: entities.city, zip: entities.zip })
        .from(entities)
        .where(and(inArray(entities.id, recent), isNull(entities.website), isNull(entities.websiteCheckedAt), eq(entities.county, "San Diego")))
        .orderBy(sql`${entities.createdAt} desc`)
        .limit(PER_RUN);

      let found = 0;
      let tried = 0;
      const queue = [...todo];
      const worker = async () => {
        for (let b = queue.shift(); b; b = queue.shift()) {
          let website: string | null = null;
          for (const domain of candidateDomains([b.dba, b.name])) {
            tried++;
            const page = await fetchPage(ctx, domain);
            if (page && pageMatches(page.html, b)) {
              website = new URL(page.url).origin;
              break;
            }
          }
          if (website) found++;
          await ctx.db.update(entities).set({ website, websiteCheckedAt: ctx.now }).where(eq(entities.id, b.id));
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      ctx.log(`websites: ${found} found for ${todo.length} businesses (${tried} addresses tried)`);
      return { rowsIn: todo.length, rowsUpserted: found, events: 0, meta: { checked: todo.length, found, tried } };
    },
  };
}
