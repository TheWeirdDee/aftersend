import "server-only";
import WebSocket from "ws";
import { pcm16ToWav } from "../audio/wav";
import { env } from "../env";
import { parseErrorFrame, protocol } from "./assemblyai-protocol";
import { SpeechProviderError, type SpeechProvider, type SynthesisInput, type SynthesisResult } from "./provider";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Voices named in AssemblyAI's TTS docs and playground; ASSEMBLYAI_TTS_VOICES overrides them. */
const DEFAULT_VOICES = [
  { id: "aai-jane", label: "Jane" },
  { id: "aai-kyla", label: "Kyla" },
];

/** Server-only AssemblyAI streaming TTS adapter. The API key never leaves this module. */
export class AssemblyAiTtsProvider implements SpeechProvider {
  readonly kind = "assemblyai" as const;

  get modelId() {
    return env().ASSEMBLYAI_TTS_MODEL ?? null;
  }

  isConfigured(): { ok: true } | { ok: false; reason: string } {
    if (!env().ASSEMBLYAI_API_KEY) return { ok: false, reason: "ASSEMBLYAI_API_KEY is not set on the server." };
    return { ok: true };
  }

  listVoices() {
    const configured = (env().ASSEMBLYAI_TTS_VOICES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id }));
    return configured.length > 0 ? configured : DEFAULT_VOICES;
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const configured = this.isConfigured();
    if (!configured.ok) throw new SpeechProviderError("not_configured", configured.reason, false);
    const spec = protocol;
    const e = env();
    const apiKey = e.ASSEMBLYAI_API_KEY!;
    const url = spec.connectionUrl(e.ASSEMBLYAI_TTS_ENDPOINT, { voiceId: input.voiceId });
    const startedAt = new Date();

    return new Promise<SynthesisResult>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let firstAudioAt: Date | null = null;
      let sessionId: string | null = null;
      let reportedDurationMs: number | null = null;
      // The server's Begin frame is authoritative for the format it actually produces.
      let sampleRate = spec.pcmFormat.sampleRate;
      let model: string | null = this.modelId;
      let settled = false;
      const ws = new WebSocket(url, { headers: spec.authHeaders(apiKey), handshakeTimeout: 10000 });

      const finish = (err: SpeechProviderError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.requestContext.signal?.removeEventListener("abort", onAbort);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
        if (err) return reject(err);
        const incomplete = completenessProblem(total, sampleRate, reportedDurationMs);
        if (incomplete) return reject(new SpeechProviderError("provider_error", incomplete, true));
        const pcm = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          pcm.set(c, off);
          off += c.byteLength;
        }
        const format = { ...spec.pcmFormat, sampleRate };
        const audio = pcm16ToWav(pcm, format);
        const bytesPerSecond = format.sampleRate * format.channels * 2;
        resolve({
          audio,
          mimeType: "audio/wav",
          durationMs: Math.round((total / bytesPerSecond) * 1000),
          reportedDurationMs,
          providerRequestId: sessionId,
          providerModel: model,
          startedAt,
          firstAudioAt,
          completedAt: new Date(),
        });
      };

      const timer = setTimeout(
        () => finish(new SpeechProviderError("timeout", "Speech synthesis timed out.", true)),
        Math.min(e.ASSEMBLYAI_TTS_TIMEOUT_MS, input.requestContext.timeoutMs ?? Infinity),
      );
      const onAbort = () => finish(new SpeechProviderError("cancelled", "Synthesis cancelled.", false));
      input.requestContext.signal?.addEventListener("abort", onAbort, { once: true });

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          const err = parseErrorFrame(data.toString("utf8"));
          if (err) return finish(mapProviderError(err.code, err.message));
        }
        const event = spec.parseFrame(data, isBinary);
        if (event.kind === "begin") {
          sessionId = event.sessionId;
          model = event.model ?? model;
          sampleRate = event.sampleRate ?? sampleRate;
          for (const frame of spec.requestFrames({ text: input.text })) ws.send(frame);
        } else if (event.kind === "audio") {
          firstAudioAt ??= new Date();
          total += event.pcm.byteLength;
          if (total > MAX_AUDIO_BYTES) return finish(new SpeechProviderError("provider_error", "Audio too large.", false));
          chunks.push(event.pcm);
        } else if (event.kind === "malformed") {
          finish(new SpeechProviderError("provider_error", event.reason, true));
        } else if (event.kind === "done") {
          reportedDurationMs = event.audioDurationMs;
          finish(null);
        } else if (event.kind === "error") {
          finish(mapProviderError(event.code, event.message));
        }
      });

      ws.on("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        finish(
          status === 401 || status === 403
            ? new SpeechProviderError("auth", "AssemblyAI rejected the credentials.", false, status)
            : status === 429
              ? new SpeechProviderError("rate_limited", "AssemblyAI rate limit reached.", true, status)
              : new SpeechProviderError("network", `Unexpected handshake response (${status}).`, status >= 500, status),
        );
      });
      ws.on("error", () => finish(new SpeechProviderError("network", "Connection to AssemblyAI failed.", true)));
      ws.on("close", (code) => {
        if (!settled) {
          finish(new SpeechProviderError("network", `Connection closed before completion (${code}).`, code !== 1008, code));
        }
      });
    });
  }
}

/**
 * Decides whether the audio received is the whole utterance. The server reports the duration it produced
 * in FlushDone, so a stream that lost frames shows up as bytes that do not add up to that duration.
 */
export function completenessProblem(totalBytes: number, sampleRate: number, reportedDurationMs: number | null): string | null {
  if (totalBytes === 0) return "Provider returned no audio.";
  if (totalBytes % 2 !== 0) return "Provider audio ended in the middle of a sample.";
  if (reportedDurationMs !== null) {
    const actualMs = (totalBytes / (sampleRate * 2)) * 1000;
    if (Math.abs(actualMs - reportedDurationMs) > Math.max(80, reportedDurationMs * 0.01)) {
      return `Provider audio is incomplete (received ${Math.round(actualMs)} ms of ${reportedDurationMs} ms).`;
    }
  }
  return null;
}

export function mapProviderError(code: number | string, message: string): SpeechProviderError {
  const text = message.toLowerCase();
  if (code === 1008 || text.includes("unauthorized")) {
    return new SpeechProviderError("auth", "AssemblyAI rejected the credentials.", false, code);
  }
  if (code === 429 || text.includes("rate limit") || text.includes("too many")) {
    return new SpeechProviderError("rate_limited", "AssemblyAI rate limit reached.", true, code);
  }
  if (code === 1011 || text.includes("internal")) {
    return new SpeechProviderError("provider_error", "AssemblyAI reported an internal error.", true, code);
  }
  return new SpeechProviderError("invalid_request", "AssemblyAI could not synthesize this text.", false, code);
}
