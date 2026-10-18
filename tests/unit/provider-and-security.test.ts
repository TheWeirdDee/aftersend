import { describe, expect, it } from "vitest";
import { parseErrorFrame, PROTOCOL_VERIFIED } from "@/lib/speech/assemblyai-protocol";
import { mapProviderError } from "@/lib/speech/assemblyai";
import { assertSafeKey, publishedKey, stagingKey } from "@/lib/storage/audio";
import { createNoticeSchema } from "@/lib/notices/validation";
import { toEnvelope, AppError } from "@/lib/http/errors";
import { newPublicToken, PUBLIC_TOKEN_PATTERN } from "@/lib/ids";

describe("AssemblyAI adapter", () => {
  it("parses the error frame observed from the live endpoint", () => {
    expect(
      parseErrorFrame('{"type":"Error","error_code":1008,"error":"Unauthorized: missing Authorization header or token query param"}'),
    ).toEqual({ code: 1008, message: "Unauthorized: missing Authorization header or token query param" });
    expect(parseErrorFrame('{"type":"Other"}')).toBeNull();
    expect(parseErrorFrame("not json")).toBeNull();
  });

  it("maps provider errors to retryable/non-retryable kinds", () => {
    expect(mapProviderError(1008, "Unauthorized")).toMatchObject({ kind: "auth", retryable: false });
    expect(mapProviderError(429, "Too many requests")).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(mapProviderError(1011, "internal error")).toMatchObject({ kind: "provider_error", retryable: true });
    expect(mapProviderError("x", "bad text")).toMatchObject({ kind: "invalid_request", retryable: false });
  });

  it("does not claim a verified protocol it has not got", () => {
    expect(PROTOCOL_VERIFIED).toBe(false);
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
