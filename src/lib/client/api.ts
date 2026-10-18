"use client";

export type ApiError = { code: string; message: string; retryable: boolean; correlationId?: string; details?: Record<string, unknown> };

export class ApiFailure extends Error {
  constructor(public readonly status: number, public readonly error: ApiError) {
    super(error.message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiFailure(0, { code: "network", message: "Can't reach AfterSend. Check your connection and try again.", retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiFailure(
      res.status,
      data && typeof data === "object" && "code" in data
        ? (data as ApiError)
        : { code: "unknown", message: `Request failed (${res.status}).`, retryable: res.status >= 500 },
    );
  }
  return data as T;
}
