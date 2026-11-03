import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { applyMigrations } from "@/lib/db/migrator";

/**
 * Two builds that start together must apply each migration once. That relies on a session-level advisory lock, which only a
 * real Postgres provides (PGlite is a single session). CI runs this against a Postgres service container; set
 * TEST_POSTGRES_URL to run it anywhere else. It creates and drops its own schema-free database, so use a scratch server.
 */
const url = process.env.TEST_POSTGRES_URL;

describe.skipIf(!url)("concurrent migrators on a real Postgres", () => {
  it("applies every migration exactly once when two start at the same time", async () => {
    const admin = postgres(url!, { max: 1, prepare: false });
    const name = `migrate_${Date.now().toString(36)}`;
    try {
      await admin.unsafe(`create database ${name}`);
      const target = new URL(url!);
      target.pathname = `/${name}`;
      await Promise.all([applyMigrations(target.toString()), applyMigrations(target.toString())]);
      const check = postgres(target.toString(), { max: 1, prepare: false });
      try {
        const [{ n }] = (await check`select count(*)::int as n from drizzle.__drizzle_migrations`) as unknown as { n: number }[];
        const { readFileSync } = await import("node:fs");
        const journal = (JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
        expect(n).toBe(journal);
      } finally {
        await check.end();
      }
    } finally {
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });
});
