import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { rateLimits } from "../db/schema";
import { AppError } from "./errors";

/** Fixed-window counter stored in Postgres so limits hold across serverless instances. */
export async function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const db = await getDb();
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = ${windowStart.toISOString()}::timestamptz then ${rateLimits.count} + 1 else 1 end`,
        windowStart,
      },
    })
    .returning({ count: rateLimits.count });
  const count = rows[0]?.count ?? 1;
  if (count > limit) {
    const retryAfterSec = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    throw new AppError("rate_limited", "Too many requests. Please wait and try again.", true, { retryAfterSec });
  }
}
