import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { AppError, toEnvelope } from "./errors";

const MAX_BODY_BYTES = 32 * 1024;

export function json(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}

export function errorResponse(err: unknown) {
  const { status, body } = toEnvelope(err);
  const res = NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const retryAfter = body.details?.retryAfterSec;
  if (typeof retryAfter === "number") res.headers.set("Retry-After", String(retryAfter));
  return res;
}

/**
 * CSRF defence for cookie-authenticated mutations: the browser-supplied Origin (or Referer) must match
 * this host. Combined with SameSite=Lax cookies and JSON-only bodies.
 */
export function assertSameOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin || !host) throw new AppError("forbidden", "Cross-site request refused.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("forbidden", "Cross-site request refused.");
  }
  if (originHost !== host) throw new AppError("forbidden", "Cross-site request refused.");
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new AppError("bad_request", "Expected a JSON body.");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new AppError("payload_too_large", "Request body is too large.");
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new AppError("payload_too_large", "Request body is too large.");
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError("bad_request", "Malformed JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError("validation_failed", first?.message ?? "Invalid request.", false, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

export function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

export function route<P = Record<string, string>>(handler: Handler<P>, opts: { mutation?: boolean } = {}): Handler<P> {
  return async (req, ctx) => {
    try {
      if (opts.mutation) assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
