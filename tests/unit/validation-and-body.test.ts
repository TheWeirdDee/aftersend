import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/http/route";
import { approveSchema, createRevisionSchema, updateDraftSchema } from "@/lib/notices/validation";

describe("PATCH schema keeps 'omitted' distinct from 'clear'", () => {
  it("leaves omitted optional fields undefined", () => {
    const parsed = updateDraftSchema.parse({ text: "Only the text changed." });
    expect(parsed.sourceUrl).toBeUndefined();
    expect(parsed.updatePreface).toBeUndefined();
    expect(parsed.title).toBeUndefined();
    expect(parsed.voiceId).toBeUndefined();
  });

  it("turns an explicit null or empty value into a clear", () => {
    expect(updateDraftSchema.parse({ sourceUrl: null }).sourceUrl).toBeNull();
    expect(updateDraftSchema.parse({ sourceUrl: "  " }).sourceUrl).toBeNull();
    expect(updateDraftSchema.parse({ updatePreface: null }).updatePreface).toBeNull();
    expect(updateDraftSchema.parse({ updatePreface: "" }).updatePreface).toBeNull();
  });

  it("keeps real values, cleaned", () => {
    expect(updateDraftSchema.parse({ sourceUrl: " https://example.com/a " }).sourceUrl).toBe("https://example.com/a");
    expect(updateDraftSchema.parse({ updatePreface: "Update: <b>4 PM</b>" }).updatePreface).toBe("Update: 4 PM");
  });

  it("still rejects a bad source URL", () => {
    expect(updateDraftSchema.safeParse({ sourceUrl: "ftp://example.com" }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ sourceUrl: "not a url" }).success).toBe(false);
  });

  it("create still defaults the preface to null", () => {
    expect(createRevisionSchema.parse({ text: "Hello" }).updatePreface).toBeNull();
  });

  it("validates client tokens and versions", () => {
    expect(createRevisionSchema.safeParse({ text: "x", clientToken: "short" }).success).toBe(false);
    expect(createRevisionSchema.safeParse({ text: "x", clientToken: "abcd1234abcd1234" }).success).toBe(true);
    expect(updateDraftSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ expectedVersion: 3 }).success).toBe(true);
  });

  it("approval must name the version", () => {
    expect(approveSchema.safeParse({ confirmedCriticalFacts: true }).success).toBe(false);
    expect(approveSchema.safeParse({ confirmedCriticalFacts: true, expectedVersion: 2 }).success).toBe(true);
    expect(approveSchema.safeParse({ confirmedCriticalFacts: false, expectedVersion: 2 }).success).toBe(false);
  });
});

function chunkedRequest(chunks: Uint8Array[], contentType = "application/json") {
  let i = 0;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const chunk = chunks[i++]!;
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      } else controller.close();
    },
  });
  // No Content-Length: a chunked upload gives the server no size to trust up front.
  const req = new NextRequest("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
  return { req, pulled: () => pulled };
}

const schema = z.object({ text: z.string() });
const enc = (s: string) => new TextEncoder().encode(s);

describe("request body limit", () => {
  it("accepts a small body sent in several chunks", async () => {
    const { req } = chunkedRequest([enc('{"text":'), enc('"hello"}')]);
    await expect(readJson(req, schema)).resolves.toEqual({ text: "hello" });
  });

  it("refuses a chunked body over 32 KB and stops reading it", async () => {
    const chunk = new Uint8Array(8 * 1024).fill(65);
    const { req, pulled } = chunkedRequest(Array.from({ length: 200 }, () => chunk));
    await expect(readJson(req, schema)).rejects.toMatchObject({ code: "payload_too_large" });
    // It gave up near the limit instead of buffering all 1.6 MB the client was ready to send.
    expect(pulled()).toBeLessThan(120 * 1024);
  });

  it("refuses an honest oversized Content-Length without reading", async () => {
    const req = new NextRequest("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "99999" },
      body: "{}",
    });
    await expect(readJson(req, schema)).rejects.toMatchObject({ code: "payload_too_large" });
  });

  it("still rejects malformed JSON and wrong content types", async () => {
    await expect(readJson(chunkedRequest([enc("{nope")]).req, schema)).rejects.toMatchObject({ code: "bad_request" });
    await expect(readJson(chunkedRequest([enc("{}")], "text/plain").req, schema)).rejects.toMatchObject({ code: "bad_request" });
  });
});
