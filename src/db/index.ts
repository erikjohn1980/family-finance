import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
/** A db handle or an open transaction. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

const g = globalThis as unknown as { __ffSql?: ReturnType<typeof postgres>; __ffDb?: DB };

export function getDb(): DB {
  if (!g.__ffDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__ffSql = postgres(url, { max: 10, onnotice: () => {} });
    g.__ffDb = drizzle(g.__ffSql, { schema });
  }
  return g.__ffDb;
}

export async function closeDb() {
  await g.__ffSql?.end();
  g.__ffSql = undefined;
  g.__ffDb = undefined;
}

export { schema };
