import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

/** Liveness only: the process answers and the database is reachable. Product readiness lives in /api/ready. */
export async function GET() {
  let database = "ok";
  try {
    await (await getDb()).execute(sql`select 1`);
  } catch {
    database = "error";
  }
  const ok = database === "ok";
  // The commit this deployment was built from (set by Vercel), so a deploy can be matched to a GitHub commit.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return json({ ok, checks: { database }, ...(commit ? { commit } : {}) }, { status: ok ? 200 : 503 });
}
