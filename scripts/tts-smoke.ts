/**
 * Real AssemblyAI synthesis smoke test. Synthesises the sample notice before and after the 3:00 PM →
 * 4:00 PM correction, saves playable WAVs under evidence/raw/audio/, and records measured timings.
 * It does not judge pronunciation: a person must listen to the files.
 *
 *   ASSEMBLYAI_API_KEY=... ASSEMBLYAI_TTS_VOICES=<verified voice> npm run tts:smoke -- --runs 3
 */
import fs from "node:fs";
import { AssemblyAiTtsProvider } from "../src/lib/speech/assemblyai";
import { inspectAudio } from "../src/lib/audio/wav";
import { sha256Hex } from "../src/lib/ids";
import { toSpeechText } from "../src/lib/notices/normalize-speech";
import { SAMPLE_NOTICE } from "../src/lib/notices/samples";

async function main() {
  const runs = Number(process.argv[process.argv.indexOf("--runs") + 1] || 1) || 1;
  const provider = new AssemblyAiTtsProvider();
  const configured = provider.isConfigured();
  if (!configured.ok) {
    console.error(`Not run: ${configured.reason}`);
    process.exit(2);
  }
  const voice = provider.listVoices()[0]!.id;
  const corrected = SAMPLE_NOTICE.text.replace(SAMPLE_NOTICE.correctedFrom, SAMPLE_NOTICE.correctedTo);
  const inputs = [
    { label: "original", text: toSpeechText(SAMPLE_NOTICE.title, SAMPLE_NOTICE.text) },
    { label: "corrected", text: toSpeechText(SAMPLE_NOTICE.title, corrected, "Update: Pickup is at 4:00 PM at the main gate.") },
  ];
  fs.mkdirSync("evidence/raw/audio", { recursive: true });
  const results = [];
  for (let i = 1; i <= runs; i++) {
    for (const input of inputs) {
      const started = Date.now();
      try {
        const r = await provider.synthesize({
          text: input.text,
          voiceId: voice,
          outputFormat: "wav",
          requestContext: { revisionId: "smoke", attemptId: `smoke-${i}-${input.label}` },
        });
        const check = inspectAudio(r.audio);
        const sha = sha256Hex(r.audio);
        const file = `evidence/raw/audio/${input.label}-run${i}-${sha.slice(0, 8)}.wav`;
        fs.writeFileSync(file, r.audio);
        results.push({
          run: i,
          label: input.label,
          ok: check.ok,
          file,
          bytes: r.audio.byteLength,
          decodedDurationMs: check.ok ? check.durationMs : null,
          timeToFirstAudioMs: r.firstAudioAt ? r.firstAudioAt.getTime() - started : null,
          totalMs: r.completedAt.getTime() - started,
          providerRequestId: r.providerRequestId,
          model: r.providerModel,
          voice,
          sha256: sha,
        });
      } catch (err) {
        results.push({ run: i, label: input.label, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), totalMs: Date.now() - started });
      }
      console.log(JSON.stringify(results[results.length - 1]));
    }
  }
  const out = `evidence/tts-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(out, JSON.stringify({ endpoint: process.env.ASSEMBLYAI_TTS_ENDPOINT ?? "wss://streaming-tts.assemblyai.com/v1/ws", inputs, results }, null, 2));
  console.log(`Saved ${out}. Listen to every file before recording it as correct.`);
}

main();
