import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
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
  const ok = checks.database === "ok" && checks.speech.startsWith("ok") && checks.storage === "ok";
  return json({ ok, checks }, { status: ok ? 200 : 503 });
}
