import { describe, expect, it } from "vitest";
import { inspectAudio, pcm16ToWav } from "@/lib/audio/wav";

const pcm = (samples: number) => new Uint8Array(new Int16Array(samples).fill(1000).buffer);

describe("WAV handling", () => {
  it("wraps PCM and reports duration", () => {
    const wav = pcm16ToWav(pcm(24000), { sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(inspectAudio(wav)).toEqual({ ok: true, mimeType: "audio/wav", durationMs: 1000, sampleRate: 24000 });
  });

  it("rejects empty, truncated and unknown audio", () => {
    expect(inspectAudio(new Uint8Array(10)).ok).toBe(false);
    const wav = pcm16ToWav(pcm(24000), { sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(inspectAudio(wav.slice(0, 2000))).toMatchObject({ ok: false, reason: "WAV data is truncated." });
    expect(inspectAudio(new Uint8Array(200).fill(9)).ok).toBe(false);
    const noSamples = pcm16ToWav(new Uint8Array(0), { sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(inspectAudio(new Uint8Array([...noSamples, ...new Uint8Array(40)])).ok).toBe(false);
  });

  it("recognises an MPEG frame sync", () => {
    const mp3 = new Uint8Array(200);
    mp3[0] = 0xff;
    mp3[1] = 0xfb;
    expect(inspectAudio(mp3)).toMatchObject({ ok: true, mimeType: "audio/mpeg" });
  });
});
