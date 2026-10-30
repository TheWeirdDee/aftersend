/** Provider-neutral speech synthesis contract. Only capabilities proven by a live call belong here. */

export type SynthesisInput = {
  text: string;
  voiceId: string;
  outputFormat: "wav";
  /** `timeoutMs` caps this one attempt so retries fit inside the caller's overall deadline. */
  requestContext: { revisionId: string; attemptId: string; signal?: AbortSignal; timeoutMs?: number };
};

export type SynthesisResult = {
  audio: Uint8Array;
  mimeType: "audio/wav" | "audio/mpeg";
  durationMs: number | null;
  /** The duration the provider itself reported for this audio, when it reports one. */
  reportedDurationMs?: number | null;
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
    /** How long the provider asked callers to wait before trying again, when it said. */
    public readonly retryAfterSec?: number,
    /** The provider's own wording, truncated. For server logs only: it is never put in an API response. */
    public readonly providerDetail?: string,
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
