/**
 * Objective checks on WAV files: structure, format, level, clipping and silence. It cannot judge pronunciation,
 * naturalness or whether every word was spoken; a person has to listen for that.
 *
 *   npx tsx scripts/inspect-audio.ts evidence/raw/audio/*.wav
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { inspectAudio } from "../src/lib/audio/wav";

const WINDOW_MS = 10;
const QUIET = 100; // below ~ -50 dBFS counts as silence
const LONG_PAUSE_MS = 700;

function analyse(file: string) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const structure = inspectAudio(bytes);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { channels: v.getUint16(22, true), sampleRate: v.getUint32(24, true), bitsPerSample: v.getUint16(34, true) };
  const dataBytes = v.getUint32(40, true);
  const samples = new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + 44 + dataBytes));
  const win = Math.round((header.sampleRate * WINDOW_MS) / 1000);

  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (a >= 32767) clipped++;
    sumSquares += s * s;
  }
  const quietWindow: boolean[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let max = 0;
    for (let j = i; j < i + win; j++) max = Math.max(max, Math.abs(samples[j]!));
    quietWindow.push(max < QUIET);
  }
  let lead = 0;
  while (lead < quietWindow.length && quietWindow[lead]) lead++;
  let tail = 0;
  while (tail < quietWindow.length - lead && quietWindow[quietWindow.length - 1 - tail]) tail++;
  const pauses: number[] = [];
  let run = 0;
  for (let i = lead; i < quietWindow.length - tail; i++) {
    if (quietWindow[i]) run++;
    else {
      if (run * WINDOW_MS >= LONG_PAUSE_MS) pauses.push(run * WINDOW_MS);
      run = 0;
    }
  }
  const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x / 32768) * 10) / 10 : -Infinity);
  return {
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    structure,
    ...header,
    durationMs: Math.round((samples.length / header.sampleRate / header.channels) * 1000),
    peakDbfs: db(peak),
    rmsDbfs: db(Math.sqrt(sumSquares / samples.length)),
    clippedSamples: clipped,
    leadingSilenceMs: lead * WINDOW_MS,
    trailingSilenceMs: tail * WINDOW_MS,
    pausesOver700ms: pauses,
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: tsx scripts/inspect-audio.ts <file.wav>...");
  process.exit(2);
}
let failed = false;
for (const f of files) {
  const r = analyse(f);
  if (!r.structure.ok) failed = true;
  console.log(JSON.stringify(r));
}
process.exit(failed ? 1 : 0);
