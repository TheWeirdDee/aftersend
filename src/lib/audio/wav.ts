/** Minimal RIFF/WAVE helpers: wrap raw PCM16 and validate files before they can be approved. */

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

/**
 * Structural decode check. Confirms the bytes are a well-formed WAV (PCM) or MPEG audio stream with
 * non-zero audio content. It says nothing about which words were spoken.
 */
export function inspectAudio(bytes: Uint8Array): AudioInspection {
  if (bytes.byteLength < 64) return { ok: false, reason: "Audio is empty or truncated." };

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bits: number } | null = null;
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
          bits: v.getUint16(body + 14, true),
        };
      } else if (id === "data") {
        if (!fmt) return { ok: false, reason: "WAV data appears before its format chunk." };
        if (fmt.format !== 1 && fmt.format !== 3) return { ok: false, reason: "Unsupported WAV encoding." };
        if (fmt.channels < 1 || fmt.sampleRate < 8000 || fmt.byteRate <= 0) {
          return { ok: false, reason: "WAV format values are invalid." };
        }
        const available = Math.min(size, bytes.byteLength - body);
        if (available <= 0) return { ok: false, reason: "WAV contains no audio samples." };
        if (available < size) return { ok: false, reason: "WAV data is truncated." };
        return {
          ok: true,
          mimeType: "audio/wav",
          durationMs: Math.round((available / fmt.byteRate) * 1000),
          sampleRate: fmt.sampleRate,
        };
      }
      offset = body + size + (size % 2);
    }
    return { ok: false, reason: "WAV has no data chunk." };
  }

  // MPEG audio: optional ID3v2 tag followed by a frame sync.
  let start = 0;
  if (ascii(bytes, 0, 3) === "ID3") {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    start = 10 + size;
  }
  if (start + 4 <= bytes.byteLength && bytes[start] === 0xff && (bytes[start + 1]! & 0xe0) === 0xe0) {
    return { ok: true, mimeType: "audio/mpeg", durationMs: null, sampleRate: null };
  }

  return { ok: false, reason: "Unrecognised audio format." };
}
