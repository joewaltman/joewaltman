import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { gzipSync } from "fflate";

// Raw downloads, kept so any run can be reprocessed. Keys look like "abc/2026-10-16/DailyExport-CSV.zip".
export interface Archive {
  put(key: string, body: Uint8Array): Promise<string>;
  // Deletes everything whose date folder is older than the cutoff. Returns how many objects went.
  prune(cutoff: string): Promise<number>;
  readonly kind: string;
}

const COMPRESSED = /\.(zip|gz|gzip|xlsx|pdf|png|jpg)$/i;

export function archiveKey(source: string, day: string, name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${source}/${day}/${COMPRESSED.test(safe) ? safe : `${safe}.gz`}`;
}

// Gzips plain files; anything that already starts with the gzip header goes in as is.
function encode(key: string, body: Uint8Array): Uint8Array {
  const alreadyGzip = body[0] === 0x1f && body[1] === 0x8b;
  return key.endsWith(".gz") && !alreadyGzip ? gzipSync(body) : body;
}

function dayOf(key: string): string | null {
  return key.split("/")[1]?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
}

export function s3Archive(opts: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  // Railway buckets use virtual-host style URLs; set true for providers that need path style.
  pathStyle?: boolean;
}): Archive {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region ?? "auto",
    forcePathStyle: opts.pathStyle ?? false,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
  return {
    kind: `s3:${opts.bucket}`,
    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: encode(key, body) }));
      return key;
    },
    async prune(cutoff) {
      let removed = 0;
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: opts.bucket, ContinuationToken: token }),
        );
        const old = (page.Contents ?? [])
          .map((o) => o.Key!)
          .filter((k) => {
            const d = dayOf(k);
            return d !== null && d < cutoff;
          });
        for (let i = 0; i < old.length; i += 1000) {
          const batch = old.slice(i, i + 1000);
          await client.send(
            new DeleteObjectsCommand({ Bucket: opts.bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
          );
          removed += batch.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return removed;
    },
  };
}

// For local runs: the same layout on disk.
export function localArchive(dir: string): Archive {
  return {
    kind: `local:${dir}`,
    async put(key, body) {
      const file = path.join(dir, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, encode(key, body));
      return key;
    },
    async prune(cutoff) {
      let removed = 0;
      for (const source of await readdir(dir).catch(() => [] as string[])) {
        for (const day of await readdir(path.join(dir, source)).catch(() => [] as string[])) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff) {
            await rm(path.join(dir, source, day), { recursive: true });
            removed++;
          }
        }
      }
      return removed;
    },
  };
}

export function memoryArchive(): Archive & { keys: string[] } {
  const keys: string[] = [];
  return {
    kind: "memory",
    keys,
    async put(key) {
      keys.push(key);
      return key;
    },
    async prune(cutoff) {
      const before = keys.length;
      keys.splice(0, keys.length, ...keys.filter((k) => (dayOf(k) ?? "9999") >= cutoff));
      return before - keys.length;
    },
  };
}

export function archiveFromEnv(env: NodeJS.ProcessEnv = process.env): Archive {
  const { ARCHIVE_S3_ENDPOINT, ARCHIVE_S3_BUCKET, ARCHIVE_S3_ACCESS_KEY_ID, ARCHIVE_S3_SECRET_ACCESS_KEY } = env;
  if (ARCHIVE_S3_ENDPOINT && ARCHIVE_S3_BUCKET && ARCHIVE_S3_ACCESS_KEY_ID && ARCHIVE_S3_SECRET_ACCESS_KEY) {
    return s3Archive({
      endpoint: ARCHIVE_S3_ENDPOINT,
      bucket: ARCHIVE_S3_BUCKET,
      accessKeyId: ARCHIVE_S3_ACCESS_KEY_ID,
      secretAccessKey: ARCHIVE_S3_SECRET_ACCESS_KEY,
      region: env.ARCHIVE_S3_REGION,
      pathStyle: env.ARCHIVE_S3_PATH_STYLE === "1",
    });
  }
  return localArchive(env.ARCHIVE_DIR ?? path.join(process.cwd(), ".archive"));
}
