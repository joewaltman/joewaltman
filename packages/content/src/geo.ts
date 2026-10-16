import { z } from "zod";
import rawTaxonomy from "../../../content/taxonomy.json";
import rawZipClusters from "../../../content/zip-clusters.json";

const zipClustersSchema = z.object({
  version: z.string(),
  county: z.string(),
  clusters: z.record(
    z.string().regex(/^[a-z0-9-]+$/),
    z.object({ label: z.string().min(1), zips: z.array(z.string().regex(/^\d{5}$/)).min(1) }),
  ),
});

const taxonomySchema = z.object({
  version: z.string(),
  categories: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        label: z.string().min(1),
        naicsPrefixes: z.array(z.string().regex(/^\d{2,6}$/)),
      }),
    )
    .min(1),
  fallback: z.object({ id: z.string(), label: z.string() }),
});

export type ZipClusters = z.infer<typeof zipClustersSchema>;
export type Taxonomy = z.infer<typeof taxonomySchema>;

export const zipClusters: ZipClusters = zipClustersSchema.parse(rawZipClusters);
export const taxonomy: Taxonomy = taxonomySchema.parse(rawTaxonomy);

const clusterByZip = new Map<string, string>();
for (const [id, c] of Object.entries(zipClusters.clusters)) {
  for (const zip of c.zips) {
    if (clusterByZip.has(zip)) throw new Error(`content/zip-clusters.json: ${zip} is in two clusters`);
    clusterByZip.set(zip, id);
  }
}

export function clusterForZip(zip: string | null | undefined): string | null {
  return zip ? (clusterByZip.get(zip.slice(0, 5)) ?? null) : null;
}

// ZIPs in any cluster are in the covered county.
export function countyForZip(zip: string | null | undefined): string | null {
  return clusterForZip(zip) ? zipClusters.county : null;
}

// The category whose NAICS prefix matches the most digits. Null when the code matches none.
export function categoryForNaics(naics: string | null | undefined): string | null {
  const code = (naics ?? "").replace(/\D/g, "");
  if (code.length < 2) return null;
  let best: { id: string; len: number } | null = null;
  for (const c of taxonomy.categories) {
    for (const p of c.naicsPrefixes) {
      if (code.startsWith(p) && (!best || p.length > best.len)) best = { id: c.id, len: p.length };
    }
  }
  return best?.id ?? null;
}
