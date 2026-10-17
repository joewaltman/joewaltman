import { z } from "zod";
import rawAbcTypes from "../../../content/abc-license-types.json";
import rawDcaTypes from "../../../content/dca-license-types.json";
import rawManualDrops from "../../../content/manual-drops.json";
import rawNpiTaxonomy from "../../../content/npi-taxonomy.json";
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

const abcSchema = z.object({
  source: z.url(),
  asOf: z.string(),
  types: z.record(z.string().regex(/^\d{2}$/), z.string().min(1)),
  barsAndRestaurants: z.array(z.string().regex(/^\d{2}$/)),
});
export const abcLicenseTypes = abcSchema.parse(rawAbcTypes);

export function abcTypeName(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().padStart(2, "0");
  return abcLicenseTypes.types[c] ?? null;
}

export function isBarOrRestaurantType(code: string | null | undefined): boolean {
  return abcLicenseTypes.barsAndRestaurants.includes((code ?? "").trim().padStart(2, "0"));
}

const dcaSchema = z.object({
  source: z.url(),
  boxFolder: z.url(),
  asOf: z.string(),
  folders: z.record(
    z.string().min(1),
    z.object({
      agency: z.string().min(1),
      types: z.record(z.string().min(1), z.object({ naics: z.string().regex(/^\d{2,6}$/), premises: z.boolean() })),
    }),
  ),
});
export const dcaLicenseTypes = dcaSchema.parse(rawDcaTypes);
export type DcaLicenseTypes = z.infer<typeof dcaSchema>;

const dropTypeSchema = z.object({
  match: z.string(),
  eventType: z.string().regex(/^[a-z_]+$/),
  severity: z.enum(["info", "watch", "serious"]),
  title: z.string().min(1),
  subject: z.enum(["grantor", "grantee"]).optional(),
});
const dropSourceSchema = z.object({
  label: z.string().min(1),
  page: z.url(),
  recordUrl: z.url(),
  verify: z.boolean(),
  statewide: z.boolean(),
  columns: z.record(z.string(), z.object({ required: z.boolean().optional(), headers: z.array(z.string().min(1)).min(1) })),
  statuses: z.object({ serious: z.array(z.string()), watch: z.array(z.string()) }).optional(),
  types: z.array(dropTypeSchema).optional(),
});
const manualDropsSchema = z.object({ asOf: z.string(), sources: z.record(z.string(), dropSourceSchema) });
export const manualDropSources = manualDropsSchema.parse(rawManualDrops);
export type DropSourceConfig = z.infer<typeof dropSourceSchema>;
export type DropTypeConfig = z.infer<typeof dropTypeSchema>;

const npiSchema = z.object({
  source: z.url(),
  asOf: z.string(),
  groups: z.array(z.object({ prefix: z.string(), label: z.string().min(1), naics: z.string().regex(/^\d{2,6}$/), skip: z.boolean().optional() })),
});
export const npiTaxonomy = npiSchema.parse(rawNpiTaxonomy);

// The group for a NUCC taxonomy code: the longest matching prefix.
export function npiGroup(code: string | null | undefined) {
  const c = (code ?? "").trim().toUpperCase();
  return npiTaxonomy.groups.filter((g) => c.startsWith(g.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0] ?? null;
}
