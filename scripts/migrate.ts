// Applies Drizzle migrations to the hosted Postgres database.
// Uses MIGRATION_DATABASE_URL (a direct or session-pooler connection) when set, otherwise DATABASE_URL.
// With --if-configured (used by the Vercel build) it skips quietly when no hosted database is set.
// With --production-only it also skips on Vercel preview and development builds, so a preview that inherited the
// production database URL can never migrate production.
import { applyMigrations } from "../src/lib/db/migrator";

async function main() {
  if (process.argv.includes("--production-only") && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.log(`Vercel environment is "${process.env.VERCEL_ENV}", not production; skipping migrations.`);
    return;
  }
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  // A production build without a database must fail loudly, not ship an app that cannot store anything.
  if (!url && process.argv.includes("--if-configured") && process.env.VERCEL_ENV !== "production") {
    console.log("No DATABASE_URL; skipping migrations.");
    return;
  }
  if (!url) throw new Error("DATABASE_URL is required (local development migrates PGlite automatically).");
  if (!process.env.MIGRATION_DATABASE_URL && /:6543\//.test(url)) {
    console.warn("Warning: migrating through the transaction pooler (port 6543). Set MIGRATION_DATABASE_URL to the session pooler (port 5432) so concurrent builds are serialised.");
  }
  await applyMigrations(url, "drizzle", process.env.DATABASE_SSL);
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
