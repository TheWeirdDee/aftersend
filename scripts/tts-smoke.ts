/**
 * Live AssemblyAI verification. Synthesises the sample notice before and after the 3:00 PM -> 4:00 PM
 * correction, saves playable WAVs under evidence/raw/audio/, and records measured timings. It checks that the
 * audio is complete (the adapter compares the bytes received with the duration the server reports) and
 * records that reported duration, which is the assumption the completeness check rests on.
 * It does NOT judge pronunciation: a person must listen to the files (see docs/LISTENING_REVIEW.md).
 *
 *   ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --runs 3                    # both voices, 3 runs each
 *   ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --runs 1 --voices aai-kyla  # one voice
 *   ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --long --runs 1            # also a ~1 800-character notice
 *   ASSEMBLYAI_API_KEY=... npm run tts:smoke -- --timeout-probe            # an attempt given 150 ms must time out
 *   npm run tts:smoke -- --bad-key-probe                                    # fake key, spends no credits
 *
 * Request budget: at most --max-requests (default 14) synthesis requests per invocation, so a typo cannot
 * run up a bill.
 */
import "./load-env";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { inspectAudio } from "../src/lib/audio/wav";
import { resetEnvCache } from "../src/lib/env";
import { toSpeechText } from "../src/lib/notices/normalize-speech";
import { SAMPLE_NOTICE } from "../src/lib/notices/samples";
import { AssemblyAiTtsProvider } from "../src/lib/speech/assemblyai";
import { DEFAULT_ENDPOINT } from "../src/lib/speech/assemblyai-protocol";
import { SpeechProviderError } from "../src/lib/speech/provider";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const runs = Number(value("--runs") ?? 1) || 1;
const maxRequests = Number(value("--max-requests") ?? 14) || 14;
let requests = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The free plan allows 5 new sessions a minute. Space requests so a normal run never trips it, and if it does, wait
// exactly as long as the service says (once) instead of recording a failure that is not about speech quality.
const paceMs = Number(value("--pace-ms") ?? 13000);
let lastStart = 0;
async function pace() {
  const wait = lastStart + paceMs - Date.now();
  if (lastStart && wait > 0) await sleep(wait);
  lastStart = Date.now();
}
async function patiently<T>(run: () => Promise<T>, onWait: (sec: number) => void): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SpeechProviderError && err.kind === "rate_limited") {
      const sec = (err.retryAfterSec ?? 30) + 1;
      console.log(`(rate limited by the service; waiting ${sec} s as it asked)`);
      await sleep(sec * 1000);
      onWait(sec);
      lastStart = Date.now();
      return await run();
    }
    throw err;
  }
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function longNotice() {
  const paragraph =
    "Dear parents and guardians, classes will end early on Friday, 24 October 2026, for a staff training day. Pickup is at 3:00 PM at the main gate. Please bring your pickup card and a form of identification. Buses will leave the school at 3:15 PM sharp. Thank you for your support.";
  const text = Array.from({ length: 7 }, () => paragraph).join("\n\n");
  return toSpeechText(SAMPLE_NOTICE.title, text);
}

async function badKeyProbe() {
  process.env.ASSEMBLYAI_API_KEY = "deliberately-invalid-key-for-probe";
  resetEnvCache();
  const started = Date.now();
  try {
    await new AssemblyAiTtsProvider().synthesize({
      text: "This request must be refused.",
      voiceId: "aai-jane",
      outputFormat: "wav",
      requestContext: { revisionId: "probe", attemptId: "probe-bad-key" },
    });
    return { probe: "bad-key", ok: false, note: "The service ACCEPTED an invalid key. Investigate before anything else." };
  } catch (err) {
    const e = err as SpeechProviderError;
    return {
      probe: "bad-key",
      ok: e instanceof SpeechProviderError && e.kind === "auth" && !e.retryable,
      kind: e.kind,
      retryable: e.retryable,
      providerCode: e.providerCode,
      elapsedMs: Date.now() - started,
    };
  }
}

async function timeoutProbe(provider: AssemblyAiTtsProvider, voice: string) {
  requests++;
  await pace();
  const started = Date.now();
  try {
    await provider.synthesize({
      text: toSpeechText(SAMPLE_NOTICE.title, SAMPLE_NOTICE.text),
      voiceId: voice,
      outputFormat: "wav",
      requestContext: { revisionId: "probe", attemptId: "probe-timeout", timeoutMs: 150 },
    });
    return { probe: "timeout", ok: false, note: "Synthesis finished inside 150 ms; the probe proves nothing." };
  } catch (err) {
    const e = err as SpeechProviderError;
    return { probe: "timeout", ok: e instanceof SpeechProviderError && e.kind === "timeout" && e.retryable, kind: e.kind, retryable: e.retryable, elapsedMs: Date.now() - started };
  }
}

async function main() {
  const out: Record<string, unknown> = { startedAt: new Date().toISOString(), endpoint: process.env.ASSEMBLYAI_TTS_ENDPOINT ?? DEFAULT_ENDPOINT };
  const probes: unknown[] = [];

  if (flag("--bad-key-probe")) {
    const probe = await badKeyProbe();
    console.log(JSON.stringify(probe));
    probes.push(probe);
    writeReport({ ...out, probes });
    process.exit((probe as { ok: boolean }).ok ? 0 : 1);
  }

  const provider = new AssemblyAiTtsProvider();
  const configured = provider.isConfigured();
  if (!configured.ok) {
    console.error(`Not run: ${configured.reason}`);
    process.exit(2);
  }
  const allVoices = provider.listVoices().map((v) => v.id);
  const voices = (value("--voices") ?? allVoices.join(",")).split(",").map((v) => v.trim()).filter(Boolean);
  for (const v of voices) {
    if (!allVoices.includes(v)) {
      console.error(`Voice ${v} is not in ASSEMBLYAI_TTS_VOICES (${allVoices.join(", ")}).`);
      process.exit(2);
    }
  }

  const corrected = SAMPLE_NOTICE.text.replace(SAMPLE_NOTICE.correctedFrom, SAMPLE_NOTICE.correctedTo);
  const inputs = [
    { label: "original", text: toSpeechText(SAMPLE_NOTICE.title, SAMPLE_NOTICE.text) },
    { label: "corrected", text: toSpeechText(SAMPLE_NOTICE.title, corrected, "Update: Pickup is at 4:00 PM at the main gate.") },
    ...(flag("--long") ? [{ label: "long", text: longNotice() }] : []),
  ];
  const planned = voices.length * runs * inputs.length + (flag("--timeout-probe") ? 1 : 0);
  if (planned > maxRequests) {
    console.error(`Refusing: this would make ${planned} synthesis requests; the budget is ${maxRequests} (--max-requests).`);
    process.exit(2);
  }

  fs.mkdirSync("evidence/raw/audio", { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (const voice of voices) {
    for (let i = 1; i <= runs; i++) {
      for (const input of inputs) {
        requests++;
        await pace();
        const started = Date.now();
        let waitedSec = 0;
        try {
          const r = await patiently(
            () =>
              provider.synthesize({
                text: input.text,
                voiceId: voice,
                outputFormat: "wav",
                requestContext: { revisionId: "smoke", attemptId: `smoke-${voice}-${i}-${input.label}` },
              }),
            (s) => (waitedSec += s),
          );
          const check = inspectAudio(r.audio);
          const digest = sha(r.audio);
          const file = `evidence/raw/audio/${voice}-${input.label}-run${i}-${digest.slice(0, 8)}.wav`;
          fs.writeFileSync(file, r.audio);
          const decoded = check.ok ? check.durationMs : null;
          results.push({
            voice,
            run: i,
            label: input.label,
            ok: check.ok,
            file,
            characters: input.text.length,
            bytes: r.audio.byteLength,
            decodedDurationMs: decoded,
            providerReportedDurationMs: r.reportedDurationMs ?? null,
            durationDeltaMs: decoded !== null && r.reportedDurationMs != null ? decoded - r.reportedDurationMs : null,
            timeToFirstAudioMs: r.firstAudioAt ? r.firstAudioAt.getTime() - started - waitedSec * 1000 : null,
            // Time spent waiting out the provider's rate-limit window is reported separately, not as latency.
            waitedForRateLimitSec: waitedSec,
            totalMs: r.completedAt.getTime() - started - waitedSec * 1000,
            providerRequestId: r.providerRequestId,
            model: r.providerModel,
            sha256: digest,
          });
        } catch (err) {
          const e = err as SpeechProviderError;
          results.push({ voice, run: i, label: input.label, ok: false, kind: e.kind, retryable: e.retryable, error: `${e.name}: ${e.message}`, totalMs: Date.now() - started });
        }
        console.log(JSON.stringify(results.at(-1)));
      }
    }
  }

  if (flag("--timeout-probe")) {
    const probe = await timeoutProbe(provider, voices[0]!);
    console.log(JSON.stringify(probe));
    probes.push(probe);
  }

  const okResults = results.filter((r) => r.ok);
  const summary = {
    requests,
    succeeded: okResults.length,
    failed: results.length - okResults.length,
    medianTotalMs: median(okResults.map((r) => r.totalMs as number)),
    medianTimeToFirstAudioMs: median(okResults.map((r) => r.timeToFirstAudioMs as number).filter((n) => Number.isFinite(n))),
    maxAbsDurationDeltaMs: Math.max(0, ...okResults.map((r) => Math.abs((r.durationDeltaMs as number | null) ?? 0))),
    humanListeningReview: "NOT DONE. Play every file and complete docs/LISTENING_REVIEW.md.",
  };
  console.log(JSON.stringify({ summary }));
  const file = writeReport({ ...out, inputs, results, probes, summary });
  console.log(`Saved ${file}. Listen to every file before recording it as correct.`);
  process.exit(summary.failed === 0 ? 0 : 1);
}

function writeReport(report: unknown) {
  const file = `evidence/tts-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

main();
