import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { json } from "@/lib/http/route";
import { speechProvider } from "@/lib/speech";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    const p = speechProvider();
    const c = p.isConfigured();
    checks.speech = c.ok ? `ok (${p.kind})` : `unavailable: ${c.reason}`;
  } catch {
    checks.speech = "error";
  }
  const ok = checks.database === "ok";
  return json({ ok, checks }, { status: ok ? 200 : 503 });
}
