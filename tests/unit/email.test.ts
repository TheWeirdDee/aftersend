import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCode, normalizeEmail } from "@/lib/auth/email-auth";
import { emailConfigured, EmailError, sendEmail } from "@/lib/email";
import { resetEnvCache } from "@/lib/env";
import { emailRef, log } from "@/lib/log";

const touched = ["EMAIL_DRIVER", "AFTERSEND_ALLOW_TEST_EMAIL", "RESEND_API_KEY", "EMAIL_FROM", "EMAIL_OUTBOX_DIR"] as const;
const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof touched)[number], string | undefined>>) {
  for (const k of touched) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
  resetEnvCache();
}

afterEach(() => {
  for (const k of touched) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
  vi.restoreAllMocks();
});

describe("email and code normalisation", () => {
  it("lower-cases and trims addresses, and rejects things that are not addresses", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
    for (const bad of ["", "no-at-sign", "a@b", "two@@example.com", "spaces in@example.com", `${"a".repeat(250)}@example.com`]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });

  it("accepts six digits with optional separators and nothing else", () => {
    expect(normalizeCode("123456")).toBe("123456");
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    for (const bad of ["", "12345", "1234567", "12345a", "abcdef", "123 45 6x"]) expect(normalizeCode(bad), bad).toBeNull();
  });
});

describe("email transport", () => {
  it("reports what is missing instead of failing later", () => {
    setEnv({ EMAIL_DRIVER: "resend" });
    expect(emailConfigured()).toMatchObject({ ok: false, reason: expect.stringContaining("RESEND_API_KEY") });
    setEnv({ EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_test" });
    expect(emailConfigured()).toMatchObject({ ok: false, reason: expect.stringContaining("EMAIL_FROM") });
    setEnv({ EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_test", EMAIL_FROM: "AfterSend <login@example.com>" });
    expect(emailConfigured()).toEqual({ ok: true, driver: "resend" });
  });

  it("refuses the file driver unless explicitly allowed", () => {
    setEnv({ EMAIL_DRIVER: "file" });
    expect(emailConfigured()).toMatchObject({ ok: false });
    setEnv({ EMAIL_DRIVER: "file", AFTERSEND_ALLOW_TEST_EMAIL: "1" });
    expect(emailConfigured()).toEqual({ ok: true, driver: "file" });
  });

  it("writes test messages to the outbox", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-"));
    setEnv({ EMAIL_DRIVER: "file", AFTERSEND_ALLOW_TEST_EMAIL: "1", EMAIL_OUTBOX_DIR: dir });
    await sendEmail({ to: "a@example.com", subject: "Hi", text: "Body" });
    const [file] = fs.readdirSync(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, file!), "utf8"))).toMatchObject({ to: "a@example.com", subject: "Hi", text: "Body" });
  });

  it("calls Resend with the key only in the Authorization header, and plain text only", async () => {
    setEnv({ EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_secret_value", EMAIL_FROM: "AfterSend <login@example.com>" });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendEmail({ to: "a@example.com", subject: "Code", text: "123456" }, fetchMock as unknown as typeof fetch);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_secret_value");
    expect(String(init.body)).not.toContain("re_secret_value");
    expect(JSON.parse(String(init.body))).toEqual({ from: "AfterSend <login@example.com>", to: ["a@example.com"], subject: "Code", text: "123456" });
  });

  it("classifies provider failures without echoing the response body", async () => {
    setEnv({ EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_secret_value", EMAIL_FROM: "x@example.com" });
    const respond = (status: number) => (async () => new Response(JSON.stringify({ message: "leaky detail re_secret_value" }), { status })) as unknown as typeof fetch;
    const rejected = await sendEmail({ to: "a@example.com", subject: "s", text: "t" }, respond(403)).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(EmailError);
    expect(rejected).toMatchObject({ retryable: false });
    expect((rejected as Error).message).not.toContain("leaky");
    expect((rejected as Error).message).not.toContain("re_secret_value");
    expect(await sendEmail({ to: "a@example.com", subject: "s", text: "t" }, respond(503)).catch((e: unknown) => e)).toMatchObject({ retryable: true });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendEmail({ to: "a@example.com", subject: "s", text: "t" }, down).catch((e: unknown) => e)).toMatchObject({ retryable: true });
  });
});

describe("logging", () => {
  it("emits one JSON line and redacts credentials by field name", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "test.event", { apiKey: "k1", RESEND_API_KEY: "k2", authorization: "Bearer x", code: "123456", sessionToken: "t", nested: { secret: "s", ok: 1 }, errorCode: "kept" });
    const line = String(spy.mock.calls[0]![0]);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "info", event: "test.event", errorCode: "kept", nested: { secret: "[redacted]", ok: 1 } });
    for (const field of ["apiKey", "RESEND_API_KEY", "authorization", "code", "sessionToken"]) expect(parsed[field]).toBe("[redacted]");
    for (const leaked of ["k1", "k2", "Bearer x", "123456"]) expect(line).not.toContain(leaked);
  });

  it("references an address without storing it", () => {
    const ref = emailRef("Someone@Example.com");
    expect(ref).toMatch(/^[0-9a-f]{12}$/);
    expect(ref).toBe(emailRef("someone@example.com"));
    expect(ref).not.toContain("someone");
  });
});
