/**
 * Opens several AssemblyAI TTS sessions back to back WITHOUT sending any text (so no characters are synthesised or
 * billed) and records what the server says to each, to observe the new-sessions-per-minute limit and the exact shape
 * of the rate-limit rejection. Prints frame types, codes and the server's own error text; never the key.
 *
 *   npm run tts:session-probe            # 8 sessions
 *   npm run tts:session-probe -- --n 12
 */
import "./load-env";
import WebSocket from "ws";
import { DEFAULT_ENDPOINT, protocol } from "../src/lib/speech/assemblyai-protocol";

const n = Number(process.argv[process.argv.indexOf("--n") + 1]) || 8;
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) {
  console.error("Not run: ASSEMBLYAI_API_KEY is not set.");
  process.exit(2);
}
const endpoint = process.env.ASSEMBLYAI_TTS_ENDPOINT || DEFAULT_ENDPOINT;

function one(i: number) {
  return new Promise<void>((resolve) => {
    const started = Date.now();
    const url = protocol.connectionUrl(endpoint, { voiceId: "aai-jane" });
    const ws = new WebSocket(url, { headers: protocol.authHeaders(key!), handshakeTimeout: 10_000 });
    const out: Record<string, unknown> = { session: i };
    const done = () => {
      out.ms = Date.now() - started;
      console.log(JSON.stringify(out));
      resolve();
    };
    const timer = setTimeout(() => {
      out.result = "no reply in 8 s";
      ws.terminate();
    }, 8000);
    ws.on("unexpected-response", (_req, res) => {
      out.handshakeStatus = res.statusCode;
      ws.terminate();
    });
    ws.on("message", (data: Buffer) => {
      try {
        const m = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
        if (m.type === "Begin") {
          out.result = "Begin";
          ws.send(JSON.stringify({ type: "Terminate" }));
        } else if (m.type === "Error") {
          out.result = "Error";
          for (const f of ["error_code", "error_type", "retryable", "retry_after_seconds", "param"]) out[f] = m[f];
          out.error = String(m.error ?? "").slice(0, 200);
        }
      } catch {
        out.result = "non-JSON frame";
      }
    });
    ws.on("error", (e) => (out.socketError = e.message));
    ws.on("close", (code) => {
      clearTimeout(timer);
      out.closeCode = code;
      done();
    });
  });
}

async function main() {
  for (let i = 1; i <= n; i++) await one(i);
}
main();
