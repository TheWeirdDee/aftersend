/**
 * Records the two short clips behind the play buttons on the landing page, with the REAL AssemblyAI text-to-speech:
 * the pickup notice as first sent (3:00 PM) and as corrected (4:00 PM). The page plays these files; nothing on it is
 * generated per visitor and no key is ever sent to the browser. It spends two synthesis requests.
 *
 *   npm run samples:record
 *
 * Writes public/samples/pickup-3pm.wav, pickup-4pm.wav and public/samples/manifest.json (the exact words spoken, the voice,
 * the measured duration and a SHA-256 of each file, so the page can say precisely what the clips are).
 */
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inspectAudio } from "../src/lib/audio/wav";
import { toSpeechText } from "../src/lib/notices/normalize-speech";
import { AssemblyAiTtsProvider } from "../src/lib/speech/assemblyai";

const TITLE = "Early pickup on Friday";
const body = (time: string) => `Classes end early on Friday for a staff training day. Pickup is at ${time} at the main gate.`;
const CLIPS = [
  { file: "pickup-3pm.wav", time: "3:00 PM" },
  { file: "pickup-4pm.wav", time: "4:00 PM" },
];

const provider = new AssemblyAiTtsProvider();
const configured = provider.isConfigured();
if (!configured.ok) {
  console.error(`The speech service is not configured (${configured.reason}). Nothing was recorded.`);
  process.exit(1);
}
const voice = provider.listVoices()[0]!;
const outDir = path.resolve("public", "samples");
fs.mkdirSync(outDir, { recursive: true });

const manifest: Record<string, unknown>[] = [];
for (const clip of CLIPS) {
  const words = toSpeechText(TITLE, body(clip.time));
  const r = await provider.synthesize({
    text: words,
    voiceId: voice.id,
    outputFormat: "wav",
    requestContext: { revisionId: "landing-sample", attemptId: clip.file, timeoutMs: 60_000 },
  });
  const check = inspectAudio(r.audio);
  if (!check.ok) throw new Error(`${clip.file}: the audio did not pass inspection`);
  fs.writeFileSync(path.join(outDir, clip.file), r.audio);
  manifest.push({
    file: clip.file,
    spoken: words,
    voice: voice.id,
    provider: "AssemblyAI",
    durationMs: r.durationMs,
    bytes: r.audio.byteLength,
    sha256: createHash("sha256").update(r.audio).digest("hex"),
    recordedAt: new Date().toISOString(),
  });
  console.log(`${clip.file}: ${r.durationMs} ms, ${r.audio.byteLength} bytes`);
}
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ clips: manifest }, null, 2) + "\n");
console.log("Wrote public/samples/manifest.json");
