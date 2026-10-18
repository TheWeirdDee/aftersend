import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { env } from "../env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Holder = { db: Promise<Db> | null; close: (() => Promise<void>) | null };
const g = globalThis as unknown as { __aftersendDb?: Holder };
const holder: Holder = (g.__aftersendDb ??= { db: null, close: null });

const migrationsFolder = path.join(process.cwd(), "drizzle");

async function connect(): Promise<Db> {
  const { DATABASE_URL, PGLITE_DIR } = env();
  if (DATABASE_URL && /^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(DATABASE_URL, { max: 5, prepare: false });
    holder.close = async () => client.end();
    return drizzle(client, { schema }) as unknown as Db;
  }

  // Local development and automated tests: embedded Postgres (PGlite), migrated on start.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir === "memory://" ? undefined : dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  holder.close = async () => client.close();
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!holder.db) {
    holder.db = connect().catch((err) => {
      holder.db = null;
      throw err;
    });
  }
  return holder.db;
}

export async function closeDb() {
  const close = holder.close;
  holder.db = null;
  holder.close = null;
  if (close) await close();
}
