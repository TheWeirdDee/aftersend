import { randomUUID } from "node:crypto";

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "audio_not_ready"
  | "facts_not_confirmed"
  | "synthesis_in_progress"
  | "synthesis_failed"
  | "provider_unavailable"
  | "provider_not_configured"
  | "notice_withdrawn"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  audio_not_ready: 409,
  facts_not_confirmed: 409,
  synthesis_in_progress: 409,
  synthesis_failed: 502,
  provider_unavailable: 503,
  provider_not_configured: 503,
  notice_withdrawn: 410,
  internal: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  get status() {
    return STATUS[this.code];
  }
}

export type ErrorEnvelope = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
};

export function toEnvelope(err: unknown): { status: number; body: ErrorEnvelope } {
  const correlationId = randomUUID();
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { code: err.code, message: err.message, retryable: err.retryable, correlationId, details: err.details },
    };
  }
  // Unknown failures are logged server-side with the correlation id only; nothing raw reaches the client.
  console.error(`[aftersend] ${correlationId}`, err instanceof Error ? err.stack ?? err.message : err);
  return {
    status: 500,
    body: { code: "internal", message: "Something went wrong on our side.", retryable: true, correlationId },
  };
}
