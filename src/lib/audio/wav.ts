/** Minimal RIFF/WAVE helpers: wrap raw PCM16, and structurally validate audio before it can be approved. */

export type PcmFormat = { sampleRate: number; channels: number; bitsPerSample: 16 };

export function pcm16ToWav(pcm: Uint8Array, format: PcmFormat): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = format;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  write(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  write(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export type AudioInspection =
  | { ok: true; mimeType: "audio/wav" | "audio/mpeg"; durationMs: number | null; sampleRate: number | null }
  | { ok: false; reason: string };

function ascii(bytes: Uint8Array, start: number, len: number) {
  return String.fromCharCode(...bytes.subarray(start, start + len));
}

/** Samples quieter than this (about -66 dBFS) count as silence. */
const SILENCE_THRESHOLD = 16;

/**
 * Structural validation, not a decode. Confirms the bytes are a self-consistent 16-bit PCM WAV (header fields
 * agree with each other and with the data length, whole samples, audible content) or a run of well-formed
 * MPEG audio frames. It says nothing about which words were spoken.
 */
export function inspectAudio(bytes: Uint8Array): AudioInspection {
  if (bytes.byteLength < 64) return { ok: false, reason: "Audio is empty or truncated." };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return inspectWav(bytes);
  return inspectMpeg(bytes);
}

function inspectWav(bytes: Uint8Array): AudioInspection {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + v.getUint32(4, true);
  if (riffEnd > bytes.byteLength) return { ok: false, reason: "WAV is truncated." };
  let offset = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bits: number } | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = v.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) return { ok: false, reason: "WAV format chunk is malformed." };
      fmt = {
        format: v.getUint16(body, true),
        channels: v.getUint16(body + 2, true),
        sampleRate: v.getUint32(body + 4, true),
        byteRate: v.getUint32(body + 8, true),
        blockAlign: v.getUint16(body + 12, true),
        bits: v.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) return { ok: false, reason: "WAV data appears before its format chunk." };
      if (fmt.format !== 1 || fmt.bits !== 16) return { ok: false, reason: "Unsupported WAV encoding (16-bit PCM only)." };
      if (fmt.channels < 1 || fmt.channels > 8 || fmt.sampleRate < 8000 || fmt.sampleRate > 192000) {
        return { ok: false, reason: "WAV format values are invalid." };
      }
      if (fmt.blockAlign !== fmt.channels * 2) return { ok: false, reason: "WAV block alignment does not match its format." };
      if (fmt.byteRate !== fmt.sampleRate * fmt.blockAlign) return { ok: false, reason: "WAV byte rate does not match its format." };
      if (body + size > bytes.byteLength) return { ok: false, reason: "WAV data is truncated." };
      if (size === 0) return { ok: false, reason: "WAV contains no audio samples." };
      if (size % fmt.blockAlign !== 0) return { ok: false, reason: "WAV data does not end on a whole sample." };
      const samples = new DataView(bytes.buffer, bytes.byteOffset + body, size);
      let audible = false;
      for (let i = 0; i + 1 < size && !audible; i += 2) audible = Math.abs(samples.getInt16(i, true)) >= SILENCE_THRESHOLD;
      if (!audible) return { ok: false, reason: "WAV is silent." };
      return { ok: true, mimeType: "audio/wav", durationMs: Math.round((size / fmt.byteRate) * 1000), sampleRate: fmt.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return { ok: false, reason: "WAV has no data chunk." };
}

// Bitrates in kbit/s, indexed by the 4-bit header field. Index 0 ("free") and 15 are not valid for our purposes.
const BITRATES: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Reads one MPEG audio frame header at `i`. Returns its length in bytes, or null if it is not a valid header. */
function mpegFrame(b: Uint8Array, i: number): { length: number; samples: number; sampleRate: number } | null {
  if (i + 4 > b.byteLength || b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
  const layer = 4 - ((b[i + 1]! >> 1) & 3); // 1..3, 4 = reserved
  const bitrateIndex = b[i + 2]! >> 4;
  const rateIndex = (b[i + 2]! >> 2) & 3;
  const padding = (b[i + 2]! >> 1) & 1;
  if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const table = BITRATES[`${mpeg1 ? 1 : 2}-${mpeg1 || layer === 1 ? layer : 2}`];
  const kbps = table?.[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version]?.[rateIndex];
  if (!kbps || !sampleRate) return null;
  if (layer === 1) return { length: (Math.floor((12 * kbps * 1000) / sampleRate) + padding) * 4, samples: 384, sampleRate };
  const samples = layer === 3 && !mpeg1 ? 576 : 1152;
  return { length: Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding, samples, sampleRate };
}

function inspectMpeg(bytes: Uint8Array): AudioInspection {
  let start = 0;
  if (ascii(bytes, 0, 3) === "ID3") {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    start = 10 + size;
  }
  let end = bytes.byteLength;
  if (end - 128 >= start && ascii(bytes, end - 128, 3) === "TAG") end -= 128; // ID3v1 trailer
  let offset = start;
  let frames = 0;
  let samples = 0;
  let sampleRate = 0;
  for (;;) {
    const f = mpegFrame(bytes, offset);
    if (!f || offset + f.length > end) break;
    frames++;
    samples += f.samples;
    sampleRate = f.sampleRate;
    offset += f.length;
  }
  // Frames must run unbroken from the start to (nearly) the end; stray bytes mean damage or truncation.
  if (frames < 2 || end - offset > 2048) return { ok: false, reason: "Unrecognised or damaged audio." };
  return { ok: true, mimeType: "audio/mpeg", durationMs: Math.round((samples / sampleRate) * 1000), sampleRate };
}
