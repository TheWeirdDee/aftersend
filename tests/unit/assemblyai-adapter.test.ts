import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";
import { inspectAudio } from "@/lib/audio/wav";
import { env, resetEnvCache } from "@/lib/env";
import { AssemblyAiTtsProvider, completenessProblem } from "@/lib/speech/assemblyai";

/**
 * The adapter against a local WebSocket server that speaks AssemblyAI's documented frames. These tests prove the
 * adapter's handling of good and bad streams; they say nothing about the real service (see `npm run tts:smoke`).
 */

type Handlers = (ws: ServerSocket, request: { url: string; authorization: string | undefined }) => void;

let server: WebSocketServer;
let handlers: Handlers = () => {};
const seen: { url?: string; authorization?: string; frames: Record<string, unknown>[] } = { frames: [] };

const pcm = (samples: number) => Buffer.from(new Int16Array(samples).fill(1000).buffer);
const frame = (o: object) => JSON.stringify(o);
const begin = (ws: ServerSocket) => ws.send(frame({ type: "Begin", id: "sess-1", configuration: { model: "assemblyai-tts-1", sample_rate: 24000 } }));

/** The documented happy path, with knobs to break it. */
function speak(opts: { chunks?: Buffer[]; reportedMs?: number | null; closeBeforeDone?: boolean; rawAudio?: string } = {}): Handlers {
  return (ws) => {
    begin(ws);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as { type: string };
      seen.frames.push(msg);
      if (msg.type !== "Flush") return;
      const chunks = opts.chunks ?? [pcm(6000), pcm(6000)]; // 12 000 samples = 500 ms
      if (opts.rawAudio !== undefined) ws.send(frame({ type: "Audio", flush_id: 0, audio: opts.rawAudio }));
      else for (const c of chunks) ws.send(frame({ type: "Audio", flush_id: 0, audio: c.toString("base64") }));
      if (opts.closeBeforeDone) return ws.close(1011);
      ws.send(frame({ type: "FlushDone", flush_id: 0, audio_duration_ms: opts.reportedMs === undefined ? 500 : opts.reportedMs }));
    });
  };
}

const input = (extra: { signal?: AbortSignal; timeoutMs?: number } = {}) => ({
  text: "Pickup is at 4:00 PM.",
  voiceId: "aai-kyla",
  outputFormat: "wav" as const,
  requestContext: { revisionId: "rev_1", attemptId: "att_1", ...extra },
});

const provider = () => new AssemblyAiTtsProvider();

beforeAll(async () => {
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (ws, req) => {
    seen.url = req.url;
    seen.authorization = req.headers.authorization;
    handlers(ws, { url: req.url ?? "", authorization: req.headers.authorization });
  });
  await new Promise((r) => server.once("listening", r));
  process.env.ASSEMBLYAI_API_KEY = "test-key-not-real";
  process.env.ASSEMBLYAI_TTS_ENDPOINT = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ws`;
  process.env.ASSEMBLYAI_TTS_TIMEOUT_MS = "5000";
  resetEnvCache();
});

afterEach(() => {
  seen.frames = [];
  handlers = () => {};
});

afterAll(() => {
  server.close();
  delete process.env.ASSEMBLYAI_API_KEY;
  delete process.env.ASSEMBLYAI_TTS_ENDPOINT;
  delete process.env.ASSEMBLYAI_TTS_TIMEOUT_MS;
  resetEnvCache();
});

describe("AssemblyAI adapter against a local protocol server", () => {
  it("sends the documented request and returns a valid WAV", async () => {
    handlers = speak();
    const result = await provider().synthesize(input());
    const url = new URL(seen.url!, "ws://x");
    expect(Object.fromEntries(url.searchParams)).toEqual({ voice_id: "aai-kyla", language: "english", sample_rate: "24000", encoding: "pcm_s16le" });
    expect(seen.authorization).toBe("test-key-not-real");
    expect(seen.frames).toEqual([{ type: "Generate", text: "Pickup is at 4:00 PM." }, { type: "Flush" }]);
    expect(inspectAudio(result.audio)).toMatchObject({ ok: true, durationMs: 500, sampleRate: 24000 });
    expect(result.providerRequestId).toBe("sess-1");
    expect(result.providerModel).toBe("assemblyai-tts-1");
    expect(result.firstAudioAt).not.toBeNull();
  });

  it("does not send the API key anywhere but the Authorization header", async () => {
    handlers = speak();
    await provider().synthesize(input());
    expect(seen.url).not.toContain("test-key-not-real");
    expect(JSON.stringify(seen.frames)).not.toContain("test-key-not-real");
  });

  it("rejects audio that is not valid base64 instead of decoding it loosely", async () => {
    handlers = speak({ rawAudio: "@@@not-base64@@@" });
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "provider_error", retryable: true, message: expect.stringContaining("base64") });
  });

  it("rejects a stream that closes before FlushDone as a retryable network failure", async () => {
    handlers = speak({ closeBeforeDone: true });
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "network", retryable: true });
  });

  it("rejects audio that falls short of the duration the server reported", async () => {
    handlers = speak({ chunks: [pcm(6000)], reportedMs: 500 }); // half the audio arrived
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "provider_error", retryable: true, message: expect.stringContaining("incomplete") });
  });

  it("rejects an utterance with no audio frames", async () => {
    handlers = speak({ chunks: [], reportedMs: 0 });
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "provider_error", retryable: true });
  });

  it("rejects audio that ends in the middle of a sample", async () => {
    handlers = speak({ chunks: [Buffer.alloc(24001, 1)], reportedMs: null });
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "provider_error", retryable: true });
  });

  it("maps an Error frame for a bad key to a non-retryable auth failure that never echoes the key", async () => {
    handlers = (ws) => ws.send(frame({ type: "Error", error_code: 1008, error: "Unauthorized: key test-key-not-real is invalid" }));
    const err = await provider().synthesize(input()).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "auth", retryable: false });
    expect(JSON.stringify({ message: (err as Error).message, stack: (err as Error).stack })).not.toContain("test-key-not-real");
  });

  it("sends a long script as several Generate frames, each under the service limit, then one Flush", async () => {
    handlers = speak();
    const sentence = "Pickup is at three p.m. at the main gate. ";
    const script = sentence.repeat(130); // about 5 500 characters
    await provider().synthesize({ ...input(), text: script });
    const generates = seen.frames.filter((f) => f.type === "Generate") as unknown as { text: string }[];
    expect(generates.length).toBeGreaterThanOrEqual(4);
    for (const g of generates) expect(g.text.length).toBeLessThanOrEqual(2000);
    expect(generates.map((g) => g.text).join("")).toBe(script);
    expect(seen.frames.at(-1)).toEqual({ type: "Flush" });
    expect(seen.frames.filter((f) => f.type === "Flush")).toHaveLength(1);
  });

  it("surfaces the new-sessions-per-minute rejection with the provider's retry hint", async () => {
    handlers = (ws) =>
      ws.send(
        frame({ type: "Error", error_code: 3009, error_type: "rate_limited", retryable: true, retry_after_seconds: 17, error: "Too many sessions opened for this account in the last minute (allowance 5 per minute); retry in 17 s." }),
      );
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "rate_limited", retryable: true, retryAfterSec: 17, providerCode: 3009 });
  });

  it("maps a rate-limit Error frame to a retryable rate_limited failure", async () => {
    handlers = (ws) => ws.send(frame({ type: "Error", error_code: 429, error: "Too many requests" }));
    await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "rate_limited", retryable: true });
  });

  it("times out a request that never finishes, using the shorter per-attempt budget", async () => {
    handlers = (ws) => begin(ws); // accepts Generate, never answers
    const started = Date.now();
    await expect(provider().synthesize(input({ timeoutMs: 300 }))).rejects.toMatchObject({ kind: "timeout", retryable: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("times out a server that never sends Begin", async () => {
    handlers = () => {};
    await expect(provider().synthesize(input({ timeoutMs: 300 }))).rejects.toMatchObject({ kind: "timeout" });
  });

  it("stops when the caller aborts, without retrying", async () => {
    handlers = (ws) => begin(ws);
    const controller = new AbortController();
    const pending = provider().synthesize(input({ signal: controller.signal }));
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toMatchObject({ kind: "cancelled", retryable: false });
  });

  it("refuses to run without an API key", async () => {
    const saved = process.env.ASSEMBLYAI_API_KEY;
    delete process.env.ASSEMBLYAI_API_KEY;
    resetEnvCache();
    try {
      expect(env().ASSEMBLYAI_API_KEY).toBeUndefined();
      await expect(provider().synthesize(input())).rejects.toMatchObject({ kind: "not_configured", retryable: false });
    } finally {
      process.env.ASSEMBLYAI_API_KEY = saved;
      resetEnvCache();
    }
  });
});

describe("completenessProblem", () => {
  it("accepts audio that matches the reported duration", () => {
    expect(completenessProblem(48000, 24000, 1000)).toBeNull();
    expect(completenessProblem(48000, 24000, 1050)).toBeNull(); // within rounding tolerance
    expect(completenessProblem(48000, 24000, null)).toBeNull(); // nothing to compare with
  });

  it("flags empty, half-sample and short audio", () => {
    expect(completenessProblem(0, 24000, 0)).toMatch(/no audio/);
    expect(completenessProblem(47999, 24000, null)).toMatch(/sample/);
    expect(completenessProblem(24000, 24000, 1000)).toMatch(/incomplete/);
    expect(completenessProblem(43000, 24000, 1000)).toMatch(/incomplete/); // about 100 ms missing
  });
});
