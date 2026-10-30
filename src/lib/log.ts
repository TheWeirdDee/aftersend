import { sha256Hex } from "./ids";

type Level = "info" | "warn" | "error";

// Anything whose name suggests a credential is replaced before it can reach a log line.
const SENSITIVE = /(api)?key$|secret|token|^code$|authorization|password|cookie/i;

function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (depth > 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : scrub(v, depth + 1)]));
}

/** One JSON object per line, so a log drain can filter by `event`. Credentials are redacted by field name. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/** A stable, non-reversible reference for correlating one address across log lines without storing it. */
export function emailRef(email: string) {
  return sha256Hex(email.toLowerCase()).slice(0, 12);
}
