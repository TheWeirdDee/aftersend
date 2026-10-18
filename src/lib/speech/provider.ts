/** Provider-neutral speech synthesis contract. Only capabilities proven by a live call belong here. */

export type SynthesisInput = {
  text: string;
  voiceId: string;
  outputFormat: "wav";
  requestContext: { revisionId: string; attemptId: string; signal?: AbortSignal };
};

export type SynthesisResult = {
  audio: Uint8Array;
  mimeType: "audio/wav" | "audio/mpeg";
  durationMs: number | null;
  providerRequestId: string | null;
  providerModel: string | null;
  startedAt: Date;
  firstAudioAt: Date | null;
  completedAt: Date;
};

export type ProviderErrorKind =
  | "auth"
  | "rate_limited"
  | "timeout"
  | "network"
  | "invalid_request"
  | "provider_error"
  | "cancelled"
  | "not_configured";

export class SpeechProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly retryable: boolean,
    public readonly providerCode?: string | number,
  ) {
    super(message);
    this.name = "SpeechProviderError";
  }
}

export type Voice = { id: string; label: string };

export interface SpeechProvider {
  /** 'assemblyai' for the sponsor integration, 'test' for the labelled automated-test double. */
  readonly kind: "assemblyai" | "test";
  readonly modelId: string | null;
  isConfigured(): { ok: true } | { ok: false; reason: string };
  listVoices(): Voice[];
  synthesize(input: SynthesisInput): Promise<SynthesisResult>;
}
