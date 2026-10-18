import "server-only";
import WebSocket from "ws";
import { pcm16ToWav } from "../audio/wav";
import { env } from "../env";
import { PROTOCOL_VERIFIED, parseErrorFrame, protocol } from "./assemblyai-protocol";
import { SpeechProviderError, type SpeechProvider, type SynthesisInput, type SynthesisResult } from "./provider";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Server-only AssemblyAI streaming TTS adapter. The API key never leaves this module. */
export class AssemblyAiTtsProvider implements SpeechProvider {
  readonly kind = "assemblyai" as const;

  get modelId() {
    return env().ASSEMBLYAI_TTS_MODEL ?? null;
  }

  isConfigured(): { ok: true } | { ok: false; reason: string } {
    if (!env().ASSEMBLYAI_API_KEY) return { ok: false, reason: "ASSEMBLYAI_API_KEY is not set on the server." };
    if (!PROTOCOL_VERIFIED || !protocol) {
      return { ok: false, reason: "The AssemblyAI TTS message protocol has not been verified yet." };
    }
    if (this.listVoices().length === 0) return { ok: false, reason: "No verified AssemblyAI voice ids are configured." };
    return { ok: true };
  }

  listVoices() {
    return (env().ASSEMBLYAI_TTS_VOICES ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id }));
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const configured = this.isConfigured();
    if (!configured.ok || !protocol) {
      throw new SpeechProviderError("not_configured", configured.ok ? "Protocol missing." : configured.reason, false);
    }
    const spec = protocol;
    const e = env();
    const apiKey = e.ASSEMBLYAI_API_KEY!;
    const url = spec.connectionUrl(e.ASSEMBLYAI_TTS_ENDPOINT, { voiceId: input.voiceId, modelId: this.modelId });
    const startedAt = new Date();

    return new Promise<SynthesisResult>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let firstAudioAt: Date | null = null;
      let settled = false;
      const ws = new WebSocket(url, { headers: spec.authHeaders(apiKey), handshakeTimeout: 10000 });

      const finish = (err: SpeechProviderError | null, requestId: string | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.requestContext.signal?.removeEventListener("abort", onAbort);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
        if (err) return reject(err);
        if (total === 0) return reject(new SpeechProviderError("provider_error", "Provider returned no audio.", true));
        const pcm = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          pcm.set(c, off);
          off += c.byteLength;
        }
        const audio = pcm16ToWav(pcm, spec.pcmFormat);
        const bytesPerSecond = spec.pcmFormat.sampleRate * spec.pcmFormat.channels * 2;
        resolve({
          audio,
          mimeType: "audio/wav",
          durationMs: Math.round((total / bytesPerSecond) * 1000),
          providerRequestId: requestId,
          providerModel: this.modelId,
          startedAt,
          firstAudioAt,
          completedAt: new Date(),
        });
      };

      const timer = setTimeout(
        () => finish(new SpeechProviderError("timeout", "Speech synthesis timed out.", true)),
        e.ASSEMBLYAI_TTS_TIMEOUT_MS,
      );
      const onAbort = () => finish(new SpeechProviderError("cancelled", "Synthesis cancelled.", false));
      input.requestContext.signal?.addEventListener("abort", onAbort, { once: true });

      ws.on("open", () => {
        for (const frame of spec.requestFrames({ text: input.text, voiceId: input.voiceId, modelId: this.modelId })) {
          ws.send(frame);
        }
      });

      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) {
          const err = parseErrorFrame(data.toString("utf8"));
          if (err) return finish(mapProviderError(err.code, err.message));
        }
        const event = spec.parseFrame(data, isBinary);
        if (event.kind === "audio") {
          firstAudioAt ??= new Date();
          total += event.pcm.byteLength;
          if (total > MAX_AUDIO_BYTES) return finish(new SpeechProviderError("provider_error", "Audio too large.", false));
          chunks.push(event.pcm);
        } else if (event.kind === "done") {
          finish(null, event.requestId);
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
