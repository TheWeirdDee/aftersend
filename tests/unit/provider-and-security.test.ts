import { describe, expect, it } from "vitest";
import { parseErrorFrame, protocol } from "@/lib/speech/assemblyai-protocol";
import { mapProviderError } from "@/lib/speech/assemblyai";
import { assertSafeKey, publishedKey, stagingKey } from "@/lib/storage/audio";
import { createNoticeSchema } from "@/lib/notices/validation";
import { toEnvelope, AppError } from "@/lib/http/errors";
import { newPublicToken, PUBLIC_TOKEN_PATTERN } from "@/lib/ids";

describe("AssemblyAI adapter", () => {
  it("parses the error frame observed from the live endpoint", () => {
    expect(
      parseErrorFrame('{"type":"Error","error_code":1008,"error":"Unauthorized: missing Authorization header or token query param"}'),
    ).toMatchObject({ code: 1008, message: "Unauthorized: missing Authorization header or token query param", errorType: null, retryAfterSec: null });
    expect(parseErrorFrame('{"type":"Other"}')).toBeNull();
    expect(parseErrorFrame("not json")).toBeNull();
  });

  it("maps provider errors to retryable/non-retryable kinds", () => {
    expect(mapProviderError({ code: 1008, message: "Unauthorized" })).toMatchObject({ kind: "auth", retryable: false });
    expect(mapProviderError({ code: 429, message: "Too many requests" })).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(mapProviderError({ code: 1011, message: "internal error" })).toMatchObject({ kind: "provider_error", retryable: true });
    expect(mapProviderError({ code: "x", message: "bad text" })).toMatchObject({ kind: "invalid_request", retryable: false });
  });

  it("builds the documented connection URL and auth header", () => {
    const url = new URL(protocol.connectionUrl("wss://tts.us.assemblyai.com/v1/ws", { voiceId: "aai-kyla" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      voice_id: "aai-kyla",
      language: "english",
      sample_rate: "24000",
      encoding: "pcm_s16le",
    });
    expect(protocol.authHeaders("k")).toEqual({ Authorization: "k" });
  });

  it("sends Generate then Flush, and parses Begin, Audio and FlushDone frames", () => {
    expect(protocol.requestFrames({ text: "It's 4 PM." }).map((f) => JSON.parse(f))).toEqual([
      { type: "Generate", text: "It's 4 PM." },
      { type: "Flush" },
    ]);
    const frame = (o: object) => protocol.parseFrame(Buffer.from(JSON.stringify(o)), false);
    expect(frame({ type: "Begin", id: "s1", configuration: { model: "assemblyai-tts-1", sample_rate: 24000 } })).toEqual({
      kind: "begin",
      sessionId: "s1",
      model: "assemblyai-tts-1",
      sampleRate: 24000,
    });
    expect(frame({ type: "Audio", flush_id: 0, audio: Buffer.from([1, 0, 2, 0]).toString("base64") })).toEqual({
      kind: "audio",
      pcm: new Uint8Array([1, 0, 2, 0]),
    });
    expect(frame({ type: "FlushDone", flush_id: 0, audio_duration_ms: 10 }).kind).toBe("done");
    expect(frame({ type: "WordBoundaries", words: [] }).kind).toBe("ignored");
    expect(protocol.parseFrame(Buffer.from("not json"), false).kind).toBe("ignored");
  });
});

describe("storage keys", () => {
  const sha = "a".repeat(64);
  it("accepts generated keys and rejects traversal", () => {
    expect(() => assertSafeKey(stagingKey("ntc_1", "rev_1", sha, "wav"))).not.toThrow();
    expect(() => assertSafeKey(publishedKey("ntc_1", "rev_1", sha, "mp3"))).not.toThrow();
    expect(() => assertSafeKey(`published/../../etc/${sha}.wav`)).toThrow();
    expect(() => assertSafeKey("published/x/y/z.wav")).toThrow();
  });
});

describe("input validation", () => {
  it("strips markup and control characters", () => {
    const r = createNoticeSchema.parse({
      title: "<b>Notice</b>",
      text: "Hello<script>x</script>\u0007 parents",
      voiceId: "v",
      sourceUrl: "",
    });
    expect(r.title).toBe("Notice");
    expect(r.text).toBe("Hellox parents");
    expect(r.sourceUrl).toBeNull();
  });

  it("rejects non-http sources and oversized text", () => {
    expect(createNoticeSchema.safeParse({ title: "t", text: "x", voiceId: "v", sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(createNoticeSchema.safeParse({ title: "t", text: "x".repeat(6001), voiceId: "v" }).success).toBe(false);
    expect(createNoticeSchema.safeParse({ title: " ", text: "x", voiceId: "v" }).success).toBe(false);
  });
});

describe("error envelopes and tokens", () => {
  it("never leaks raw errors", () => {
    const { status, body } = toEnvelope(new Error("db password=hunter2"));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.correlationId).toMatch(/[0-9a-f-]{36}/);
    expect(toEnvelope(new AppError("conflict", "x")).status).toBe(409);
  });

  it("public tokens carry 128 bits and match the route pattern", () => {
    const t = newPublicToken();
    expect(t).toMatch(PUBLIC_TOKEN_PATTERN);
    expect(new Set(Array.from({ length: 1000 }, newPublicToken)).size).toBe(1000);
  });
});

describe("environment parsing", () => {
  it("treats blank optional values, as in a copied .env.example, as unset", async () => {
    const { env, resetEnvCache } = await import("@/lib/env");
    const saved = { APP_URL: process.env.APP_URL, SUPABASE_URL: process.env.SUPABASE_URL };
    process.env.APP_URL = "";
    process.env.SUPABASE_URL = "";
    try {
      resetEnvCache();
      expect(env().APP_URL).toBeUndefined();
      expect(env().SUPABASE_URL).toBeUndefined();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetEnvCache();
    }
  });
});

describe("the shipped .env.example", () => {
  it("boots as written: blank values mean unset and nothing fails validation", async () => {
    const fs = await import("node:fs");
    const { env, resetEnvCache } = await import("@/lib/env");
    const parsed: Record<string, string> = {};
    for (const line of fs.readFileSync(".env.example", "utf8").split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const eq = line.indexOf("=");
      // Same rule dotenv applies to unquoted values: an inline comment starts at " #".
      parsed[line.slice(0, eq).trim()] = line.slice(eq + 1).replace(/\s+#.*$/, "").trim();
    }
    expect(parsed.APP_URL).toBe("");
    expect(parsed.SUPABASE_URL).toBe("");
    const names = Object.keys(parsed);
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    Object.assign(process.env, parsed);
    try {
      resetEnvCache();
      const e = env();
      expect(e.APP_URL).toBeUndefined();
      expect(e.SUPABASE_URL).toBeUndefined();
      expect(e.SPEECH_PROVIDER).toBe("assemblyai");
      expect(e.ASSEMBLYAI_API_KEY).toBeUndefined();
      expect(e.ASSEMBLYAI_TTS_ENDPOINT).toBe("wss://tts.us.assemblyai.com/v1/ws");
      expect(e.ASSEMBLYAI_TTS_TIMEOUT_MS).toBeLessThan(e.SYNTHESIS_DEADLINE_MS);
    } finally {
      for (const [n, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
      resetEnvCache();
    }
  });
});

describe("AssemblyAI service limits", () => {
  it("parses the rate-limit frame exactly as the service sent it on 30 Oct 2026", async () => {
    const { parseErrorFrame } = await import("@/lib/speech/assemblyai-protocol");
    const { mapProviderError } = await import("@/lib/speech/assemblyai");
    const live =
      '{"type":"Error","error_code":3009,"error_type":"rate_limited","retryable":true,"retry_after_seconds":38,"param":null,"error":"Too many sessions opened for this account in the last minute (allowance 5 per minute); retry in 38 s."}';
    const frame = parseErrorFrame(live)!;
    expect(frame).toMatchObject({ code: 3009, errorType: "rate_limited", retryable: true, retryAfterSec: 38 });
    const err = mapProviderError(frame);
    expect(err).toMatchObject({ kind: "rate_limited", retryable: true, retryAfterSec: 38, providerCode: 3009 });
    // The client-facing message is fixed text; the provider's wording is kept for logs only.
    expect(err.message).toBe("AssemblyAI rate limit reached.");
    expect(err.providerDetail).toContain("allowance 5 per minute");
  });

  it("classifies the other documented codes", async () => {
    const { mapProviderError } = await import("@/lib/speech/assemblyai");
    expect(mapProviderError({ code: 3005, message: "at capacity", errorType: "at_capacity", retryable: true, retryAfterSec: null })).toMatchObject({ kind: "provider_error", retryable: true });
    expect(mapProviderError({ code: 3006, message: "Generate.text too long", errorType: "invalid_message", retryable: false, retryAfterSec: null })).toMatchObject({ kind: "invalid_request", retryable: false });
    expect(mapProviderError({ code: 3010, message: "Input text rate exceeded", errorType: "input_rate_exceeded", retryable: false, retryAfterSec: null })).toMatchObject({ kind: "invalid_request", retryable: false });
    expect(mapProviderError({ code: 4000, message: "something new", errorType: "new_thing", retryable: true, retryAfterSec: null })).toMatchObject({ kind: "provider_error", retryable: true });
  });

  it("splits long scripts under the 2 000-character frame limit and loses nothing", async () => {
    const { chunkForGenerate, MAX_GENERATE_CHARS } = await import("@/lib/speech/assemblyai-protocol");
    const sentence = "Pickup is at three p.m. at the main gate. ";
    const script = sentence.repeat(160); // about 6 700 characters
    const chunks = chunkForGenerate(script);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join("")).toBe(script); // consecutive texts are joined exactly as sent
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_GENERATE_CHARS);
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(" ")).toBe(true); // cut at a sentence end, space kept
    expect(chunkForGenerate("short")).toEqual(["short"]);
    expect(chunkForGenerate("")).toEqual([""]);
  });

  it("cuts at a space when there is no sentence end, and never splits an emoji or a word-less run badly", async () => {
    const { chunkForGenerate } = await import("@/lib/speech/assemblyai-protocol");
    const words = "word ".repeat(1000);
    const chunks = chunkForGenerate(words);
    expect(chunks.join("")).toBe(words);
    expect(chunks.every((c) => c.length <= 1800 && c.endsWith(" "))).toBe(true);
    const emoji = "😀".repeat(2000); // 4 000 UTF-16 units, no spaces: forced hard cuts
    const parts = chunkForGenerate(emoji);
    expect(parts.join("")).toBe(emoji);
    for (const p of parts) expect(Array.from(p).every((ch) => ch === "😀")).toBe(true); // no lone surrogates
  });
});
