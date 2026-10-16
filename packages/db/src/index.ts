import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";

// Shared by the postgres-js client in the app and the PGlite client in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __jwDb?: Db };

export function getDb(): Db {
  if (globalForDb.__jwDb) return globalForDb.__jwDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // The local PGlite dev server cannot interleave connections, so dev runs set DATABASE_POOL_MAX=1.
  const client = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
  const db = drizzle(client, { schema }) as unknown as Db;
  globalForDb.__jwDb = db;
  return db;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
