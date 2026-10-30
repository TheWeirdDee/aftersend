import postgres from "postgres";

/** Plain TCP to this machine needs no TLS; everything else does. `DATABASE_SSL=disable` is the explicit escape hatch. */
export function sslFor(url: string, override?: string): "require" | false {
  if (override === "disable") return false;
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
  } catch {
    // An unparseable URL fails later with a clearer error; do not guess here.
  }
  return "require";
}

/**
 * Options for the application's pooled client. `prepare: false` is required behind a transaction pooler. The idle
 * and connect timeouts keep a serverless instance from holding connections open, or hanging, when the database is
 * slow or unreachable.
 */
export function appClient(url: string, max: number, sslOverride?: string) {
  return postgres(url, { max, prepare: false, ssl: sslFor(url, sslOverride), idle_timeout: 20, connect_timeout: 10 });
}
