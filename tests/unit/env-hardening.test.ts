import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkProductionConfig, checkValueShapes } from "@/lib/config-check";
import { passwordOf, withPassword } from "../../scripts/db-password";
import { inlineCommentNames, parseEnvFile } from "../../scripts/env-file";

function tmpEnv(text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aftersend-env-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, text);
  return file;
}

describe("a value must be what its author meant on every host", () => {
  // The production incident: Vercel stored `3                 # note` whole, so the numbers became NaN.
  it.each([
    ["DATABASE_POOL_MAX", "3                 # connections per server instance"],
    ["ASSEMBLYAI_TTS_TIMEOUT_MS", "30000       # one synthesis attempt"],
    ["SYNTHESIS_DEADLINE_MS", "50000 #the whole request"],
    ["APP_URL", "https://example.com # the public address"],
  ])("flags an inline comment inside %s", (name, value) => {
    const problems = checkValueShapes({ [name]: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
    expect(problems[0]).toContain("inline comment");
  });

  it("flags quotes and stray spaces that would become part of the value", () => {
    expect(checkValueShapes({ DATABASE_POOL_MAX: '"3"' })[0]).toContain("quote");
    expect(checkValueShapes({ CRON_SECRET: " secret " })[0]).toContain("whitespace");
  });

  it("flags a setting that must be a number but is not", () => {
    expect(checkValueShapes({ AUTH_EMAILS_PER_DAY: "sixty" })).toEqual(["AUTH_EMAILS_PER_DAY must be a whole number."]);
    expect(checkValueShapes({ DATABASE_POOL_MAX: "3.5" })).toEqual(["DATABASE_POOL_MAX must be a whole number."]);
  });

  it("accepts clean values, blanks, and variables the app does not own", () => {
    expect(checkValueShapes({ DATABASE_POOL_MAX: "3", SYNTHESIS_DEADLINE_MS: "50000", ASSEMBLYAI_TTS_VOICES: "aai-jane,aai-kyla", EMAIL_FROM: "AfterSend <login@example.com>", APP_URL: "" })).toEqual([]);
    expect(checkValueShapes({ SOME_HOST_VARIABLE: "has # a hash and  spaces " })).toEqual([]);
  });

  it("reports names, never the value", () => {
    const secret = "sk-very-secret # trailing";
    const report = JSON.stringify(checkValueShapes({ ASSEMBLYAI_API_KEY: secret }));
    expect(report).toContain("ASSEMBLYAI_API_KEY");
    expect(report).not.toContain("sk-very-secret");
  });

  it("is part of the production check, so a deploy and /api/ready both refuse it", () => {
    const base = {
      DATABASE_URL: "postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres",
      STORAGE_DRIVER: "supabase",
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
      OBJECT_STORAGE_BUCKET: "b",
      ASSEMBLYAI_API_KEY: "k",
      RESEND_API_KEY: "k",
      EMAIL_FROM: "AfterSend <a@example.com>",
      AUTH_SECRET: "x".repeat(44),
      CRON_SECRET: "y".repeat(48),
      APP_URL: "https://aftersend.example.com",
      MIGRATION_DATABASE_URL: "postgres://u:p@aws-0-eu.pooler.supabase.com:5432/postgres",
    };
    expect(checkProductionConfig(base).problems).toEqual([]);
    const bad = checkProductionConfig({ ...base, DATABASE_POOL_MAX: "3   # per instance" });
    expect(bad.problems.some((p) => p.includes("DATABASE_POOL_MAX") && p.includes("inline comment"))).toBe(true);
  });
});

describe("env files", () => {
  it("names the variables that carry an inline comment, and only those", () => {
    const file = tmpEnv(
      [
        "# a comment on its own line is fine",
        "A=1",
        "B=2   # inline",
        'C="quoted # hash is kept"',
        "D=https://example.com/#fragment",
        "E=",
        "F=5 #tight",
      ].join("\n"),
    );
    expect(inlineCommentNames(file)).toEqual(["B", "F"]);
  });

  it("the local loader still drops inline comments, which is why the raw check exists", () => {
    const file = tmpEnv("DATABASE_POOL_MAX=3   # note\n");
    expect(parseEnvFile(file).DATABASE_POOL_MAX).toBe("3");
    expect(inlineCommentNames(file)).toEqual(["DATABASE_POOL_MAX"]);
  });

  it(".env.example has no inline comments, so a copy of it is safe to send to any host", () => {
    expect(inlineCommentNames(".env.example")).toEqual([]);
    expect(checkValueShapes(parseEnvFile(".env.example"))).toEqual([]);
  });
});

describe("putting a password into a connection string", () => {
  const URL_6543 = "postgresql://postgres.abcdef:OLD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";

  it.each(["simple", "p@ss:w/rd", "50%off", "a#b?c&d=e", "spaces and + plus", "ünïcode✓", "\\back\\slash", "end@"])("round-trips %j", (password) => {
    const url = withPassword(URL_6543, password);
    expect(passwordOf(url)).toBe(password);
    const parsed = new URL(url);
    expect(parsed.username).toBe("postgres.abcdef");
    expect(parsed.hostname).toBe("aws-0-eu-west-1.pooler.supabase.com");
    expect(parsed.port).toBe("6543");
    expect(parsed.pathname).toBe("/postgres");
  });

  it("replaces an old password that itself contained a raw @", () => {
    const messy = "postgresql://postgres.abcdef:old@Raw1@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require";
    const url = withPassword(messy, "new@secret");
    expect(passwordOf(url)).toBe("new@secret");
    expect(new URL(url).hostname).toBe("aws-0-eu-west-1.pooler.supabase.com");
    expect(new URL(url).search).toBe("?sslmode=require");
    expect(url).not.toContain("Raw1");
  });

  it("refuses something that is not a postgres connection string", () => {
    expect(() => withPassword("https://example.com", "x")).toThrow();
    expect(() => withPassword("postgres://nopassword@host/db", "x")).toThrow();
  });
});
