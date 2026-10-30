import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { checkProductionConfig, isHostedProduction } from "@/lib/config-check";
import { emailConfigured } from "@/lib/email";
import { env } from "@/lib/env";
import { json } from "@/lib/http/route";
import { speechProvider } from "@/lib/speech";
import { probeObjectStore } from "@/lib/storage/audio";

export const dynamic = "force-dynamic";

/**
 * Readiness: everything a publisher needs is configured and reachable. Unlike /api/health, which only
 * says the process and database are up, this fails when speech or storage cannot do their job. The speech
 * check confirms configuration only; it never makes a billable provider call.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  try {
    await (await getDb()).execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    const p = speechProvider();
    const c = p.isConfigured();
    checks.speech = c.ok ? `ok (${p.kind})` : `unavailable: ${c.reason}`;
  } catch (err) {
    checks.speech = err instanceof Error ? `unavailable: ${err.message}` : "error";
  }
  try {
    await probeObjectStore();
    checks.storage = "ok";
  } catch {
    checks.storage = "error";
  }
  const mail = emailConfigured();
  checks.email = mail.ok ? `ok (${mail.driver})` : `unavailable: ${mail.reason}`;
  // Sign-in codes are signed with AUTH_SECRET; without it, production refuses to issue them.
  checks.auth = env().AUTH_SECRET || env().NODE_ENV !== "production" ? "ok" : "unavailable: AUTH_SECRET is not set on the server.";
  if (isHostedProduction()) {
    // Names and reasons only; a value is never reported.
    const report = checkProductionConfig(process.env);
    checks.config = report.problems.length === 0 ? "ok" : `invalid: ${report.problems.join(" ")}`;
  }
  const ok =
    checks.database === "ok" && checks.speech.startsWith("ok") && checks.storage === "ok" && checks.email.startsWith("ok") && checks.auth === "ok" && (checks.config === undefined || checks.config === "ok");
  return json({ ok, checks }, { status: ok ? 200 : 503 });
}
