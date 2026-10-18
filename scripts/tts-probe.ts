/**
 * Protocol discovery probe for the hackathon TTS endpoint. Connects with ASSEMBLYAI_API_KEY and records
 * every frame the server sends (JSON printed, binary summarised by size) so the wire protocol can be
 * confirmed from real behaviour rather than guessed. The key is never printed.
 *
 *   npm run tts:probe                          # connect and listen
 *   npm run tts:probe -- --auth bearer         # try "Bearer <key>" instead of the bare key
 *   npm run tts:probe -- --send frame.json     # send one documented JSON frame after open
 *   npm run tts:probe -- --no-key              # observe the unauthenticated response
 */
import fs from "node:fs";
import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};

const endpoint = process.env.ASSEMBLYAI_TTS_ENDPOINT ?? "wss://streaming-tts.assemblyai.com/v1/ws";
const key = process.env.ASSEMBLYAI_API_KEY;
const noKey = args.includes("--no-key");
if (!key && !noKey) {
  console.error("ASSEMBLYAI_API_KEY is not set. Use --no-key to observe the unauthenticated response.");
  process.exit(1);
}
const auth = flag("--auth") === "bearer" ? `Bearer ${key}` : key;
const sendPath = flag("--send");
const listenMs = Number(flag("--listen-ms") ?? 8000);

const log: unknown[] = [];
const started = Date.now();
const record = (entry: Record<string, unknown>) => {
  const e = { t_ms: Date.now() - started, ...entry };
  log.push(e);
  console.log(JSON.stringify(e));
};

const ws = new WebSocket(endpoint, { headers: noKey ? {} : { Authorization: auth! }, handshakeTimeout: 10000 });
ws.on("upgrade", (res) => record({ event: "upgrade", status: res.statusCode }));
ws.on("unexpected-response", (_req, res) => {
  record({ event: "unexpected-response", status: res.statusCode });
  ws.terminate();
});
ws.on("open", () => {
  record({ event: "open" });
  if (sendPath) {
    const frame = fs.readFileSync(sendPath, "utf8");
    ws.send(frame);
    record({ event: "sent", bytes: frame.length });
  }
  setTimeout(() => ws.close(1000), listenMs);
});
ws.on("message", (data: Buffer, isBinary: boolean) => {
  if (isBinary) record({ event: "binary", bytes: data.byteLength, head_hex: data.subarray(0, 16).toString("hex") });
  else {
    const text = data.toString("utf8");
    let parsed: unknown = text.slice(0, 2000);
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      // Summarise large base64 payloads instead of printing them.
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && v.length > 200) obj[k] = `<string ${v.length} chars>`;
      }
      parsed = obj;
    } catch {}
    record({ event: "text", message: parsed });
  }
});
ws.on("error", (err) => record({ event: "error", message: err.message }));
ws.on("close", (code, reason) => {
  record({ event: "close", code, reason: reason.toString() });
  fs.mkdirSync("evidence/raw", { recursive: true });
  const out = `evidence/raw/tts-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(out, JSON.stringify({ endpoint, authScheme: noKey ? "none" : flag("--auth") ?? "bare", log }, null, 2));
  console.log(`Saved ${out}`);
});
