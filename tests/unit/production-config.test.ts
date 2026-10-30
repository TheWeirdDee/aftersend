import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProductionConfig, cookiesAreSecure, isHostedProduction } from "@/lib/config-check";
import { sslFor } from "@/lib/db/connection";
import { emailConfigured } from "@/lib/email";
import { resetEnvCache } from "@/lib/env";
import { siteUrl } from "@/lib/site-url";
import { speechProvider } from "@/lib/speech";
import { parseEnvFile } from "../../scripts/env-file";

/** A complete, valid production environment. Every test below breaks exactly one thing. */
const GOOD = {
  APP_URL: "https://aftersend.example.com",
  DATABASE_URL: "postgres://postgres.abc:pw@aws-0-eu.pooler.supabase.com:6543/postgres",
  MIGRATION_DATABASE_URL: "postgres://postgres.abc:pw@aws-0-eu.pooler.supabase.com:5432/postgres",
  DATABASE_POOL_MAX: "3",
  STORAGE_DRIVER: "supabase",
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_placeholder",
  OBJECT_STORAGE_BUCKET: "aftersend-audio",
  SPEECH_PROVIDER: "assemblyai",
  ASSEMBLYAI_API_KEY: "placeholder",
  EMAIL_DRIVER: "resend",
  RESEND_API_KEY: "re_placeholder",
  EMAIL_FROM: "AfterSend <login@example.com>",
  AUTH_SECRET: "x".repeat(44),
  CRON_SECRET: "y".repeat(48),
} as Record<string, string>;

const without = (name: string) => Object.fromEntries(Object.entries(GOOD).filter(([k]) => k !== name));
const withEnv = (extra: Record<string, string>) => ({ ...GOOD, ...extra });

describe("production configuration check", () => {
  it("accepts a complete configuration without problems or warnings", () => {
    expect(checkProductionConfig(GOOD)).toEqual({ problems: [], warnings: [] });
  });

  it.each([
    ["DATABASE_URL", /DATABASE_URL is not set/],
    ["ASSEMBLYAI_API_KEY", /ASSEMBLYAI_API_KEY is not set/],
    ["RESEND_API_KEY", /RESEND_API_KEY is not set/],
    ["EMAIL_FROM", /EMAIL_FROM is not set/],
    ["AUTH_SECRET", /AUTH_SECRET is not set/],
    ["CRON_SECRET", /CRON_SECRET is not set/],
    ["SUPABASE_URL", /SUPABASE_URL is not set/],
    ["SUPABASE_SERVICE_ROLE_KEY", /SUPABASE_SERVICE_ROLE_KEY is not set/],
    ["OBJECT_STORAGE_BUCKET", /OBJECT_STORAGE_BUCKET is not set/],
  ])("reports a missing %s", (name, pattern) => {
    expect(checkProductionConfig(without(name)).problems.join(" ")).toMatch(pattern);
  });

  it("refuses a connection string that still has its password placeholder, without revealing the string", () => {
    const withPlaceholder = withEnv({ DATABASE_URL: "postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-eu.pooler.supabase.com:6543/postgres" });
    const report = checkProductionConfig(withPlaceholder);
    expect(report.problems.join(" ")).toMatch(/DATABASE_URL still contains its password placeholder/);
    expect(JSON.stringify(report)).not.toContain("pooler.supabase.com");
    expect(checkProductionConfig(withEnv({ MIGRATION_DATABASE_URL: "postgresql://u:[YOUR-PASSWORD]@h:5432/p" })).problems.join(" ")).toMatch(/MIGRATION_DATABASE_URL still contains/);
  });

  it("refuses the local storage driver and the embedded database", () => {
    expect(checkProductionConfig(withEnv({ STORAGE_DRIVER: "local" })).problems.join(" ")).toMatch(/does not persist/);
    expect(checkProductionConfig(without("DATABASE_URL")).problems.join(" ")).toMatch(/embedded database cannot persist/);
    expect(checkProductionConfig(withEnv({ DATABASE_URL: "mysql://nope" })).problems.join(" ")).toMatch(/postgres:\/\//);
  });

  it("refuses every test double and insecure switch", () => {
    for (const bad of <Record<string, string>[]>[
      { SPEECH_PROVIDER: "test" },
      { EMAIL_DRIVER: "file" },
      { AFTERSEND_ALLOW_TEST_PROVIDER: "1" },
      { AFTERSEND_ALLOW_TEST_EMAIL: "1" },
      { AFTERSEND_INSECURE_COOKIES: "1" },
    ]) {
      expect(checkProductionConfig(withEnv(bad)).problems, JSON.stringify(bad)).not.toEqual([]);
    }
  });

  it("rejects weak secrets and an unusable public address", () => {
    expect(checkProductionConfig(withEnv({ AUTH_SECRET: "short" })).problems.join(" ")).toMatch(/AUTH_SECRET is shorter/);
    expect(checkProductionConfig(withEnv({ CRON_SECRET: "short" })).problems.join(" ")).toMatch(/CRON_SECRET is shorter/);
    expect(checkProductionConfig(withEnv({ APP_URL: "http://aftersend.example.com" })).problems.join(" ")).toMatch(/https/);
    expect(checkProductionConfig(withEnv({ APP_URL: "https://localhost:3000" })).problems.join(" ")).toMatch(/localhost/);
    expect(checkProductionConfig(withEnv({ APP_URL: "not a url" })).problems.join(" ")).toMatch(/not a valid URL/);
  });

  it("keeps the synthesis deadline under the route limit and the pool size sane", () => {
    expect(checkProductionConfig(withEnv({ SYNTHESIS_DEADLINE_MS: "60000" })).problems.join(" ")).toMatch(/below the 60 s/);
    expect(checkProductionConfig(withEnv({ SYNTHESIS_DEADLINE_MS: "50000" })).problems).toEqual([]);
    expect(checkProductionConfig(withEnv({ DATABASE_POOL_MAX: "0" })).problems.join(" ")).toMatch(/DATABASE_POOL_MAX/);
    expect(checkProductionConfig(withEnv({ DATABASE_POOL_MAX: "50" })).problems.join(" ")).toMatch(/DATABASE_POOL_MAX/);
  });

  it("warns, without failing, about pooler and address mistakes", () => {
    const noMigrationUrl = checkProductionConfig(without("MIGRATION_DATABASE_URL"));
    expect(noMigrationUrl.problems).toEqual([]);
    expect(noMigrationUrl.warnings.join(" ")).toMatch(/MIGRATION_DATABASE_URL is not set/);
    expect(checkProductionConfig(withEnv({ MIGRATION_DATABASE_URL: GOOD.DATABASE_URL! })).warnings.join(" ")).toMatch(/port 6543/);
    expect(checkProductionConfig(withEnv({ DATABASE_URL: "postgres://postgres:pw@db.abcdef.supabase.co:5432/postgres" })).warnings.join(" ")).toMatch(/IPv6/);
    expect(checkProductionConfig(withEnv({ DATABASE_URL: "postgres://u:pw@aws-0-eu.pooler.supabase.com:5432/postgres" })).warnings.join(" ")).toMatch(/session pooler/);
    expect(checkProductionConfig(without("APP_URL")).warnings.join(" ")).toMatch(/APP_URL is not set/);
  });

  it("never puts a value in its output", () => {
    const report = checkProductionConfig(withEnv({ AUTH_SECRET: "tiny-secret-value", CRON_SECRET: "tiny-cron-value", APP_URL: "http://localhost:9" }));
    const text = JSON.stringify(report);
    for (const secret of ["tiny-secret-value", "tiny-cron-value", "sb_secret_placeholder", "re_placeholder", "pw@"]) expect(text).not.toContain(secret);
  });
});

describe("hosted production guards", () => {
  const touched = ["VERCEL_ENV", "AFTERSEND_ENV", "SPEECH_PROVIDER", "AFTERSEND_ALLOW_TEST_PROVIDER", "EMAIL_DRIVER", "AFTERSEND_ALLOW_TEST_EMAIL"] as const;
  const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of touched) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvCache();
  });

  it("recognises Vercel production and the explicit switch, and nothing else", () => {
    expect(isHostedProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(isHostedProduction({ AFTERSEND_ENV: "production" })).toBe(true);
    expect(isHostedProduction({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isHostedProduction({ NODE_ENV: "production" })).toBe(false); // local production builds (e2e) must keep working
    expect(isHostedProduction({})).toBe(false);
  });

  it("marks the session cookie Secure in production, and only a local production build may opt out", () => {
    expect(cookiesAreSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookiesAreSecure({ NODE_ENV: "development" })).toBe(false); // plain http on localhost
    expect(cookiesAreSecure({ NODE_ENV: "production", AFTERSEND_INSECURE_COOKIES: "1" })).toBe(false); // the e2e server
    // On hosted production the switch is ignored, whatever its value.
    expect(cookiesAreSecure({ NODE_ENV: "production", VERCEL_ENV: "production", AFTERSEND_INSECURE_COOKIES: "1" })).toBe(true);
    expect(cookiesAreSecure({ NODE_ENV: "production", AFTERSEND_ENV: "production", AFTERSEND_INSECURE_COOKIES: "1" })).toBe(true);
    // A preview deployment is still production-built over https, so the exemption does not apply there either.
    expect(cookiesAreSecure({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("refuses the test speech provider even when it was explicitly allowed", () => {
    process.env.SPEECH_PROVIDER = "test";
    process.env.AFTERSEND_ALLOW_TEST_PROVIDER = "1";
    resetEnvCache();
    expect(speechProvider().kind).toBe("test"); // fine off production
    process.env.VERCEL_ENV = "production";
    expect(() => speechProvider()).toThrow(/refused on hosted production/);
  });

  it("refuses the file mailbox even when it was explicitly allowed", () => {
    process.env.EMAIL_DRIVER = "file";
    process.env.AFTERSEND_ALLOW_TEST_EMAIL = "1";
    resetEnvCache();
    expect(emailConfigured()).toEqual({ ok: true, driver: "file" });
    process.env.AFTERSEND_ENV = "production";
    expect(emailConfigured()).toMatchObject({ ok: false, reason: expect.stringContaining("refused on hosted production") });
  });
});

describe("public address for metadata", () => {
  it("prefers APP_URL, then Vercel's production address, then the deployment address, then localhost", () => {
    expect(siteUrl({ APP_URL: "https://a.example.com/", VERCEL_PROJECT_PRODUCTION_URL: "p.vercel.app", VERCEL_URL: "d.vercel.app" })).toBe("https://a.example.com");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "p.vercel.app", VERCEL_URL: "d.vercel.app" })).toBe("https://p.vercel.app");
    expect(siteUrl({ VERCEL_URL: "d.vercel.app" })).toBe("https://d.vercel.app");
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("database connection options", () => {
  it("uses TLS for every non-local host and none for this machine", () => {
    expect(sslFor("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres")).toBe("require");
    expect(sslFor("postgres://u:p@db.abc.supabase.co:5432/postgres")).toBe("require");
    for (const local of ["postgres://u:p@localhost:5432/x", "postgres://u:p@127.0.0.1:5432/x", "postgres://u:p@[::1]:5432/x"]) expect(sslFor(local)).toBe(false);
    expect(sslFor("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres", "disable")).toBe(false);
  });
});

describe("env file parsing (shared by check:env and the scripts)", () => {
  it("matches dotenv: comment-only values are blank, quotes are removed, inline comments are cut", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "envfile-")), ".env");
    fs.writeFileSync(file, ['# header', 'A=   # server-only', 'B=value   # trailing', 'C="quoted # not a comment"', "D='single'", "E=", "export_not_a_var", "F=a=b=c"].join("\n"));
    expect(parseEnvFile(file)).toEqual({ A: "", B: "value", C: "quoted # not a comment", D: "single", E: "", F: "a=b=c" });
  });
});
