import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { sslFor } from "./connection";

// Any constant works; it only has to be the same in every process that migrates this database.
const MIGRATION_LOCK_KEY = 727274001;

/**
 * Applies pending migrations while holding a session-level advisory lock, so two builds that start together (a push
 * and a redeploy, or two preview branches pointed at one database) run them one after the other instead of racing on
 * the migration journal. Idempotent: with nothing pending it changes nothing.
 *
 * Needs a session-capable connection: a direct connection or Supabase's session pooler (port 5432). Through a
 * transaction pooler (port 6543) the lock may be released between statements, so it is not a guarantee there.
 */
export async function applyMigrations(url: string, migrationsFolder = "drizzle", sslOverride?: string) {
  const client = postgres(url, { max: 1, prepare: false, ssl: sslFor(url, sslOverride), connect_timeout: 15 });
  try {
    await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {});
    await client.end();
  }
}
