import { createHash } from "node:crypto";
import { pcm16ToWav } from "../audio/wav";
import { SpeechProviderError, type SpeechProvider, type SynthesisInput, type SynthesisResult } from "./provider";

/**
 * TEST-ONLY speech double. It never produces speech: it renders a short two-tone signal whose length
 * tracks the word count, so automated tests can exercise storage, validation and promotion without
 * spending sponsor credits. Every asset it creates is stored with providerKind = "test" and the UI
 * labels it "Test audio — not AssemblyAI". It is unavailable unless AFTERSEND_ALLOW_TEST_PROVIDER=1.
 */
export const FAIL_MARKER = "[[fail-synthesis]]";

export class TestToneProvider implements SpeechProvider {
  readonly kind = "test" as const;
  readonly modelId = "test-tone";

  isConfigured() {
    return { ok: true as const };
  }

  listVoices() {
    return [{ id: "test-tone", label: "Test tone (not speech)" }];
  }

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    const startedAt = new Date();
    if (input.requestContext.signal?.aborted) throw new SpeechProviderError("cancelled", "Cancelled.", false);
    if (input.text.includes(FAIL_MARKER)) {
      throw new SpeechProviderError("provider_error", "Test provider: injected synthesis failure.", false, "test_fault");
    }
    const sampleRate = 24000;
    const words = input.text.trim().split(/\s+/).length;
    const seconds = Math.min(20, Math.max(1, words * 0.12));
    const samples = Math.round(sampleRate * seconds);
    // Pitch is derived from the text so different scripts always yield different bytes.
    const seed = createHash("sha256").update(input.text).digest().readUInt16BE(0);
    const base = 330 + (seed % 220);
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      const t = i / sampleRate;
      const freq = Math.floor(t * 2) % 2 === 0 ? base : base * 1.25;
      const envelope = Math.min(1, (samples - i) / 2400, i / 2400);
      pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.18 * envelope * 32767);
    }
    const audio = pcm16ToWav(new Uint8Array(pcm.buffer), { sampleRate, channels: 1, bitsPerSample: 16 });
    const completedAt = new Date();
    return {
      audio,
      mimeType: "audio/wav",
      durationMs: Math.round(seconds * 1000),
      providerRequestId: `test-${input.requestContext.attemptId}`,
      providerModel: this.modelId,
      startedAt,
      firstAudioAt: completedAt,
      completedAt,
    };
  }
}
