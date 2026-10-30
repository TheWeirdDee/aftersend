import { describe, expect, it } from "vitest";
import { inspectAudio, pcm16ToWav } from "@/lib/audio/wav";

const pcm = (samples: number, value = 1000) => new Uint8Array(new Int16Array(samples).fill(value).buffer);
const fmt = { sampleRate: 24000, channels: 1, bitsPerSample: 16 } as const;
const goodWav = () => pcm16ToWav(pcm(24000), fmt);

/** Overwrites header fields in a copy of a WAV so single inconsistencies can be tested one at a time. */
function patched(wav: Uint8Array, edits: Record<number, [value: number, bytes: 2 | 4]>) {
  const copy = wav.slice();
  const v = new DataView(copy.buffer);
  for (const [offset, [value, bytes]] of Object.entries(edits)) {
    if (bytes === 2) v.setUint16(Number(offset), value, true);
    else v.setUint32(Number(offset), value, true);
  }
  return copy;
}

describe("WAV validation", () => {
  it("wraps PCM and reports duration", () => {
    expect(inspectAudio(goodWav())).toEqual({ ok: true, mimeType: "audio/wav", durationMs: 1000, sampleRate: 24000 });
  });

  it("rejects empty, truncated and unknown audio", () => {
    expect(inspectAudio(new Uint8Array(10)).ok).toBe(false);
    expect(inspectAudio(goodWav().slice(0, 2000))).toMatchObject({ ok: false, reason: "WAV is truncated." });
    expect(inspectAudio(new Uint8Array(200).fill(9)).ok).toBe(false);
    const noSamples = pcm16ToWav(new Uint8Array(0), fmt);
    expect(inspectAudio(new Uint8Array([...noSamples, ...new Uint8Array(40)]))).toMatchObject({ ok: false });
  });

  it("rejects a data chunk that claims more bytes than the file holds", () => {
    expect(inspectAudio(patched(goodWav(), { 40: [48000 * 5, 4] }))).toMatchObject({ ok: false, reason: "WAV data is truncated." });
  });

  it("rejects header fields that disagree with each other", () => {
    expect(inspectAudio(patched(goodWav(), { 28: [12345, 4] }))).toMatchObject({ ok: false, reason: expect.stringContaining("byte rate") });
    expect(inspectAudio(patched(goodWav(), { 32: [4, 2] }))).toMatchObject({ ok: false, reason: expect.stringContaining("block alignment") });
  });

  it("rejects encodings and bit depths other than 16-bit PCM", () => {
    expect(inspectAudio(patched(goodWav(), { 20: [3, 2] }))).toMatchObject({ ok: false, reason: expect.stringContaining("Unsupported") });
    expect(inspectAudio(patched(goodWav(), { 34: [8, 2], 32: [1, 2], 28: [24000, 4] }))).toMatchObject({ ok: false, reason: expect.stringContaining("Unsupported") });
    expect(inspectAudio(patched(goodWav(), { 24: [100, 4], 28: [200, 4] }))).toMatchObject({ ok: false, reason: expect.stringContaining("invalid") });
  });

  it("rejects data that does not end on a whole sample", () => {
    const wav = goodWav();
    const odd = new Uint8Array(wav.byteLength - 1);
    odd.set(wav.subarray(0, wav.byteLength - 1));
    const v = new DataView(odd.buffer);
    v.setUint32(40, 47999, true);
    v.setUint32(4, odd.byteLength - 8, true);
    expect(inspectAudio(odd)).toMatchObject({ ok: false, reason: expect.stringContaining("whole sample") });
  });

  it("rejects digital silence", () => {
    expect(inspectAudio(pcm16ToWav(pcm(24000, 0), fmt))).toMatchObject({ ok: false, reason: "WAV is silent." });
    expect(inspectAudio(pcm16ToWav(pcm(24000, 3), fmt))).toMatchObject({ ok: false, reason: "WAV is silent." }); // inaudible noise floor
  });
});

/** Builds MPEG-1 Layer III frames at 128 kbit/s, 44.1 kHz: header FF FB 90 00, 417 bytes each (418 when padded). */
function mp3(frames: number, { id3 = false, tail = 0 }: { id3?: boolean; tail?: number } = {}) {
  const parts: number[] = [];
  if (id3) parts.push(0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0));
  for (let i = 0; i < frames; i++) {
    const frame = new Array(417).fill(0x55);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x90;
    frame[3] = 0x00;
    parts.push(...frame);
  }
  parts.push(...new Array(tail).fill(0));
  return new Uint8Array(parts);
}

describe("MPEG validation", () => {
  it("accepts an unbroken run of frames and reports their duration", () => {
    const result = inspectAudio(mp3(40));
    expect(result).toMatchObject({ ok: true, mimeType: "audio/mpeg", sampleRate: 44100 });
    if (result.ok) expect(result.durationMs).toBe(Math.round((40 * 1152 * 1000) / 44100));
  });

  it("skips an ID3v2 tag", () => {
    expect(inspectAudio(mp3(10, { id3: true }))).toMatchObject({ ok: true, mimeType: "audio/mpeg" });
  });

  it("rejects a bare frame-sync prefix with nothing behind it", () => {
    const sync = new Uint8Array(200);
    sync[0] = 0xff;
    sync[1] = 0xfb;
    expect(inspectAudio(sync)).toMatchObject({ ok: false });
  });

  it("rejects reserved header values and damaged streams", () => {
    const badRate = mp3(10);
    badRate[2] = 0x9c; // reserved sample-rate index
    expect(inspectAudio(badRate).ok).toBe(false);
    const damaged = mp3(10);
    damaged[417 * 5] = 0x00; // sixth frame loses its sync, leaving stray bytes
    expect(inspectAudio(damaged).ok).toBe(false);
    expect(inspectAudio(mp3(10, { tail: 5000 })).ok).toBe(false);
  });
});
