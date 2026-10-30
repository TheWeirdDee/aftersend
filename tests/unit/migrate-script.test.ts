import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * `scripts/migrate.ts` is what the Vercel build runs before `next build`. These are the decisions that protect
 * production, run exactly as the build would run them (a real process, a controlled environment).
 */
function migrate(extraArgs: string[], env: Record<string, string>) {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "VERCEL_ENV", "DATABASE_SSL"]) delete clean[k];
  // Node running tsx's own entry point: no shell, so the arguments are passed through exactly as written.
  const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts", ...extraArgs], {
    env: { ...clean, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

describe("migration script decisions", () => {
  it("skips quietly when no database is configured and this is not a production build", () => {
    const r = migrate(["--if-configured", "--production-only"], {});
    expect(r.code).toBe(0);
    expect(r.out).toContain("No DATABASE_URL; skipping migrations.");
  });

  it("FAILS a production build that has no database, instead of shipping an app that cannot store anything", () => {
    const r = migrate(["--if-configured", "--production-only"], { VERCEL_ENV: "production" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("DATABASE_URL is required");
  });

  it("never migrates on a preview or development build, even if it inherited the production database URL", () => {
    for (const vercelEnv of ["preview", "development"]) {
      // An unreachable address: if the script tried to connect, this would fail or hang instead of exiting 0.
      const r = migrate(["--if-configured", "--production-only"], { VERCEL_ENV: vercelEnv, DATABASE_URL: "postgres://u:p@203.0.113.1:6543/postgres" });
      expect(r.code, vercelEnv).toBe(0);
      expect(r.out).toContain(`Vercel environment is "${vercelEnv}", not production; skipping migrations.`);
    }
  });

  it("requires a database when migrating explicitly", () => {
    const r = migrate([], {});
    expect(r.code).toBe(1);
    expect(r.out).toContain("DATABASE_URL is required");
  });

  it("warns, naming the fix, when it would migrate through the transaction pooler", () => {
    // Port 6543 with nothing listening: the script warns first, then fails to connect. Only the warning is under test.
    const r = migrate([], { DATABASE_URL: "postgres://u:p@127.0.0.1:6543/postgres" });
    expect(r.out).toContain("MIGRATION_DATABASE_URL");
    expect(r.out).not.toContain("u:p@");
  });
});
