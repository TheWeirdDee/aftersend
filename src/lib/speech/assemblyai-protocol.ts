/**
 * AssemblyAI streaming TTS wire protocol (wss://streaming-tts.assemblyai.com/v1/ws).
 *
 * VERIFIED (live probe, 18 Oct 2026, no credentials):
 *   - The endpoint accepts a WebSocket upgrade (server: Python websockets 15.0.1).
 *   - Without credentials the server sends one JSON text frame and closes:
 *       {"type":"Error","error_code":1008,"error":"Unauthorized: missing Authorization header or token query param"}
 *     i.e. credentials go in an `Authorization` header or a `token` query parameter.
 *
 * NOT YET VERIFIED (requires organiser docs or an authenticated probe — see scripts/tts-probe.ts):
 *   - Authorization value format (bare key vs. "Bearer"), model ids, voice ids.
 *   - Client message schema for submitting text and signalling end of input.
 *   - Audio frame format (binary vs. base64 JSON), encoding, sample rate, completion message.
 *
 * Until the unverified parts are filled in from an authoritative source, PROTOCOL_VERIFIED stays false
 * and the adapter refuses to synthesize. Nothing in this file may be guessed.
 */

export const PROTOCOL_VERIFIED = false;

export type ServerEvent =
  | { kind: "audio"; pcm: Uint8Array }
  | { kind: "done"; requestId: string | null }
  | { kind: "error"; code: number | string; message: string }
  | { kind: "ignored" };

/** The one server message shape observed so far. */
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
  connectionUrl(endpoint: string, opts: { voiceId: string; modelId: string | null }): string;
  /** Frames to send after the socket opens. */
  requestFrames(opts: { text: string; voiceId: string; modelId: string | null }): (string | Uint8Array)[];
  parseFrame(data: Buffer, isBinary: boolean): ServerEvent;
  pcmFormat: { sampleRate: number; channels: number; bitsPerSample: 16 };
};

/** Populated only from verified documentation. */
export const protocol: ProtocolSpec | null = null;
