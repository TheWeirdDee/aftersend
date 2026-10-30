/**
 * AssemblyAI streaming TTS wire protocol (wss://tts.us.assemblyai.com/v1/ws).
 *
 * Source: AssemblyAI Streaming TTS quickstart, "Using the WebSocket API directly"
 * (https://www.assemblyai.com/docs/tts/getting-started/quickstart), checked against the
 * playground's curl example. Confirmed live by `npm run tts:smoke`; see RESULTS.md for the run.
 *
 *   - Auth: the raw API key in the `Authorization` header ("Bearer <key>" is also accepted).
 *   - Voice and audio options are query parameters: voice_id, language, sample_rate, encoding.
 *   - The server speaks first with a `Begin` frame carrying the session id and configuration.
 *   - Client frames are JSON text: `Generate` { text }, `Flush`, `Terminate`.
 *   - `Audio` frames carry base64 codec bytes (raw 16-bit mono PCM here, no header).
 *   - `FlushDone` ends a request. `WordBoundaries` and `Termination` are not needed and ignored.
 *   - `Error` frames: { error_code, error }. A rejected key or voice arrives as `Error` instead of `Begin`.
 */

export const PROTOCOL_VERIFIED = true;

export const DEFAULT_ENDPOINT = "wss://tts.us.assemblyai.com/v1/ws";
export const SAMPLE_RATE = 24000;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type ServerEvent =
  | { kind: "begin"; sessionId: string | null; model: string | null; sampleRate: number | null }
  | { kind: "audio"; pcm: Uint8Array }
  | { kind: "done"; audioDurationMs: number | null }
  /** A frame the protocol promises but whose contents cannot be trusted (bad base64, odd sample count). */
  | { kind: "malformed"; reason: string }
  | { kind: "error"; code: number | string; message: string }
  | { kind: "ignored" };

export function parseErrorFrame(raw: string): { code: number | string; message: string } | null {
  try {
    const msg = JSON.parse(raw) as { type?: unknown; error_code?: unknown; error?: unknown };
    if (msg.type === "Error") {
      return {
        code: typeof msg.error_code === "number" || typeof msg.error_code === "string" ? msg.error_code : "unknown",
        message: typeof msg.error === "string" ? msg.error : "Provider error",
      };
    }
  } catch {
    // not JSON
  }
  return null;
}

export type ProtocolSpec = {
  authHeaders(apiKey: string): Record<string, string>;
  connectionUrl(endpoint: string, opts: { voiceId: string }): string;
  /** Frames to send once the server's Begin frame has arrived. */
  requestFrames(opts: { text: string }): string[];
  parseFrame(data: Buffer, isBinary: boolean): ServerEvent;
  pcmFormat: { sampleRate: number; channels: number; bitsPerSample: 16 };
};

export const protocol: ProtocolSpec = {
  authHeaders: (apiKey) => ({ Authorization: apiKey }),

  connectionUrl(endpoint, { voiceId }) {
    const url = new URL(endpoint);
    url.searchParams.set("voice_id", voiceId);
    url.searchParams.set("language", "english");
    url.searchParams.set("sample_rate", String(SAMPLE_RATE));
    url.searchParams.set("encoding", "pcm_s16le");
    return url.toString();
  },

  requestFrames: ({ text }) => [JSON.stringify({ type: "Generate", text }), JSON.stringify({ type: "Flush" })],

  parseFrame(data, isBinary) {
    if (isBinary) return { kind: "ignored" };
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    } catch {
      return { kind: "ignored" };
    }
    switch (msg.type) {
      case "Begin": {
        const config = (msg.configuration ?? {}) as Record<string, unknown>;
        return {
          kind: "begin",
          sessionId: typeof msg.id === "string" ? msg.id : null,
          model: typeof config.model === "string" ? config.model : null,
          sampleRate: typeof config.sample_rate === "number" ? config.sample_rate : null,
        };
      }
      case "Audio": {
        if (typeof msg.audio !== "string") return { kind: "malformed", reason: "Audio frame without a payload." };
        // Buffer.from silently skips invalid characters, which would turn corruption into plausible-looking audio.
        if (!BASE64.test(msg.audio) || msg.audio.length % 4 !== 0) {
          return { kind: "malformed", reason: "Audio frame is not valid base64." };
        }
        return { kind: "audio", pcm: new Uint8Array(Buffer.from(msg.audio, "base64")) };
      }
      case "FlushDone":
        return { kind: "done", audioDurationMs: typeof msg.audio_duration_ms === "number" ? msg.audio_duration_ms : null };
      default:
        return { kind: "ignored" };
    }
  },

  pcmFormat: { sampleRate: SAMPLE_RATE, channels: 1, bitsPerSample: 16 },
};
